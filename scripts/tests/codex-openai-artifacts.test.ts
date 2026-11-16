import {expect,test} from 'vitest';
import {OpenAIHostedArtifacts} from '../codex-openai-artifacts.ts';
const session='sess_fixture_1';
const artifact=(id:string,path:string)=>({
  id,created_at:1,environment_id:'env_fixture',object:'agent.session.artifact',
  path,session_id:session,size_bytes:4,turn_id:'turn_fixture_1',
});
const page=(data:unknown[],has_more=false,last_id:string|null=null)=>
  new Response(JSON.stringify({object:'list',data,has_more,last_id}),{status:200});
test('fixed-origin API lists all pages with trusted sanitized IDs',async()=>{
  const calls:{url:string,init:RequestInit}[]=[];
  const client=new OpenAIHostedArtifacts('fixture-secret',async(url,init)=>{
    calls.push({url,init});
    return calls.length===1?page([artifact('art_one','/workspace/outputs/proposal.patch')],true,'art_one'):
      page([artifact('art_two','/workspace/outputs/manifest.json')]);
  });
  const result=await client.listArtifacts(session);
  expect(result.allPagesRead).toBe(true);
  expect(result.items.map(x=>x.id)).toEqual(['art_one','art_two']);
  expect(calls[0]!.url).toBe('https://api.openai.com/v1/agents/sessions/'+session+'/artifacts?limit=100&order=asc');
  expect(calls[1]!.url).toContain('&after=art_one');
  expect(calls[0]!.init.redirect).toBe('error');
  expect(calls[0]!.init.headers).toMatchObject({'OpenAI-Beta':'agents=v1',Authorization:'Bearer fixture-secret'});
  expect(calls[0]!.url).not.toContain('fixture-secret');
});
test('rejects all forged, missing or out-of-session artifacts and pagination loops',async()=>{
  const bad=[
    page([{...artifact('art_ok','/workspace/outputs/proposal.patch'),session_id:'sess_wrong'}]),
    page([artifact('art_ok','/tmp/leak')]),
    page([artifact('art_ok','/workspace/outputs/ok')],true,'bad/cursor'),
    page([artifact('art_ok','/workspace/outputs/ok')],true,null),
    page([artifact('art_ok','/workspace/outputs/ok')],true,'art_one'),
  ];
  for (const response of bad) {
    const client=new OpenAIHostedArtifacts('fixture',async()=>response.clone());
    await expect(client.listArtifacts(session)).rejects.toThrow();
  }
  await expect(new OpenAIHostedArtifacts('key',async()=>page([])).listArtifacts('../bad')).rejects.toThrow();
});
test('artifact download is streamed with byte caps and no full-body allocation',async()=>{
  const client=new OpenAIHostedArtifacts('key',async()=>{
    const body=new ReadableStream<Uint8Array>({
      start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3]));c.close();}
    });
    return new Response(body,{status:200});
  });
  expect(await client.downloadBounded(session,'art_ok',3)).toEqual(new Uint8Array([1,2,3]));
  await expect(client.downloadBounded(session,'art_ok',2)).rejects.toThrow('hosted-body-size');
  await expect(client.downloadBounded(session,'art/evil',4)).rejects.toThrow();
});
test('rejects overstated content-length without reading',async()=>{
  const client=new OpenAIHostedArtifacts('key',async()=>new Response(new Uint8Array([1,2]),
    {status:200,headers:{'content-length':'200'}}));
  await expect(client.downloadBounded(session,'art_ok',2)).rejects.toThrow('hosted-body-content-length');
});
test('delete requires positive matching provider confirmation',async()=>{
  const good=new OpenAIHostedArtifacts('key',async()=>new Response(JSON.stringify({
    deleted:true,id:session,object:'agent.session.deleted',
  }),{status:200}));
  await expect(good.deleteSession(session)).resolves.toBeUndefined();
  const bad=new OpenAIHostedArtifacts('key',async()=>new Response(JSON.stringify({
    deleted:true,id:'sess_other',object:'agent.session.deleted',
  }),{status:200}));
  await expect(bad.deleteSession(session)).rejects.toThrow('hosted-delete-unconfirmed');
});
test('HTTP failures never echo response bodies or secrets',async()=>{
  const client=new OpenAIHostedArtifacts('secret-fixture',async()=>new Response(
    'private provider error secret-fixture',{status:409}));
  let message='';
  try{await client.listArtifacts(session);}catch(e){message=String(e);}
  expect(message).toContain('hosted-http-status');
  expect(message).not.toContain('secret-fixture');
  expect(message).not.toContain('private provider error');
});
