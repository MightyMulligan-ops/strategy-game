import {test,expect} from 'vitest';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OpenAIResponsesTransport,createUnixGateway} from '../codex-responses-gateway.ts';
import type {BoundedResponsesGate} from '../codex-run-control.ts';
import {probeNamespaceIsolation} from '../codex-runtime-preflight.ts';

test('transport binds fixed provider origin/project, counts the complete input and never retries',async()=>{
  const calls:{url:string;options:RequestInit}[]=[];
  const fetcher=async(url:string|URL|Request,options?:RequestInit)=>{
    calls.push({url:String(url),options:options!});
    return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:17}),{status:200});
  };
  const transport=new OpenAIResponsesTransport('synthetic-fixture-key','proj_fixture',fetcher as typeof fetch);
  const body={model:'fixture-model',input:'x',instructions:'count me',tools:[{type:'function',name:'fixture'}],store:false,stream:true,max_output_tokens:100};
  expect(await transport.countInputTokens(body)).toBe(17);
  expect(JSON.parse(calls[0]!.options.body as string)).toEqual({model:'fixture-model',input:'x',instructions:'count me',tools:body.tools});
  expect(calls[0]!.url).toBe('https://api.openai.com/v1/responses/input_tokens');expect(calls[0]!.options.redirect).toBe('error');
  expect(calls[0]!.options.headers).toMatchObject({'OpenAI-Project':'proj_fixture'});
  let attempts=0;
  const failed=new OpenAIResponsesTransport('synthetic-fixture-key','proj_fixture',(async()=>{attempts++;throw Error('secret fixture detail');}) as typeof fetch);
  await expect(failed.infer(body)).rejects.toThrow('provider-transport');expect(attempts).toBe(1);
});
test('malformed provider token evidence never becomes an admitted count',async()=>{
  for(const body of ['null','{}',JSON.stringify({object:'wrong',input_tokens:1}),'x'.repeat(8193)]){
    const transport=new OpenAIResponsesTransport('synthetic-fixture-key','proj_fixture',(async()=>new Response(body)) as typeof fetch);
    await expect(transport.countInputTokens({model:'fixture',input:'x'})).rejects.toThrow();
  }
});
test('Unix gateway forwards only allowed model endpoint and emits no raw error details',async(context)=>{
  const directory=await mkdtemp(join(tmpdir(),'sovereign-gateway-'));const socket=join(directory,'model.sock');let calls=0;
  const gate={request:async()=>{calls++;return new Response('data: fixture\n\n',{headers:{'content-type':'text/event-stream'}});}} as unknown as BoundedResponsesGate;
  let server;
  try {server=await createUnixGateway(socket,gate);} catch(error) {
    await rm(directory,{recursive:true,force:true});
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {context.skip();return;}
    throw error;
  }
  const send=(method:string,path:string)=>new Promise<{status:number;body:string}>((resolve,reject)=>{
    const req=httpRequest({socketPath:socket,path,method,headers:{'Content-Type':'application/json'}},res=>{
      let body='';res.on('data',c=>{body+=String(c);});res.on('end',()=>resolve({status:res.statusCode!,body}));
    });req.on('error',reject);req.end(method === 'POST' ? '{}' : undefined);
  });
  try{
    expect(await send('POST','/v1/responses')).toEqual({status:200,body:'data: fixture\n\n'});
    expect(await send('GET','/v1/models')).toEqual({status:403,body:'{"error":"request_blocked"}'});expect(calls).toBe(1);
    await expect(createUnixGateway(socket,gate)).rejects.toThrow('gateway-path-exists');
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
test('sandbox preflight has no unreviewed-tool or insecure fallback',async()=>{
  await expect(probeNamespaceIsolation('unknown')).rejects.toThrow('unreviewed-sandbox-tool');
  expect(await probeNamespaceIsolation('0'.repeat(64))).toEqual({available:false,reason:'sandbox-tool-unverified-or-unavailable'});
});
