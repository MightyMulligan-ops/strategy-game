import {expect,test} from 'vitest';
import {parseAgentSse,OpenAIHostedStreamingProvider} from '../codex-hosted-stream.ts';
import type {HostedSessionRequest} from '../codex-hosted-agents.ts';

const encode=(s:string)=>new TextEncoder().encode(s);
const stream=(chunks:string[])=>new ReadableStream<Uint8Array>({
  start(controller){for(const chunk of chunks)controller.enqueue(encode(chunk));controller.close();}
});
const request:HostedSessionRequest={
  agent:{model:'gpt-6-astra',instructions:'code'},
  environment:{type:'openai_hosted',container_size:'medium',
    network:{access:'disabled'},files:[{type:'file_id',path:'/workspace/source.tar.gz',file_id:'file_fixture'}],
    setup_commands:[{command:'true'}]},input:'fix combat',stream:true,
};
const event=(value:unknown)=>'data: '+JSON.stringify(value)+'\n\n';
const sid='sess_fixture',tid='turn_fixture';
test('SSE parser supports split chunks and ignores status/comments',async()=>{
  const text=': keepalive\n\n'+event({type:'agent.session.idle',session_id:sid})+
    event({type:'agent.session.turn.completed',session_id:sid,turn:{id:tid,subagent_id:null}});
  const chunks=[text.slice(0,12),text.slice(12,39),text.slice(39)];
  const result=[];
  for await(const item of parseAgentSse(stream(chunks)))result.push(item);
  expect(result.map(x=>x.type)).toEqual(['agent.session.idle','agent.session.turn.completed']);
});
test('stream parser handles CRLF records split between carriage return and newline',async()=>{
  const raw='data: '+JSON.stringify({type:'agent.session.turn.completed',session_id:'sess_fixture',turn:{id:'turn_fixture',subagent_id:null}})+'\r\n\r\n';
  const split=raw.indexOf('\r\n');
  const parts=[raw.slice(0,split+1),raw.slice(split+1,raw.length-2),raw.slice(raw.length-2)];
  const received=[];
  for await(const e of parseAgentSse(stream(parts)))received.push(e.type);
  expect(received).toEqual(['agent.session.turn.completed']);
});

test('HTTP 201 accepted for streamed session creation',async()=>{
  const provider=new OpenAIHostedStreamingProvider('fixture-key',async()=>
    new Response(stream([event({type:'agent.session.turn.completed',session_id:'sess_fixture',turn:{id:'turn_fixture',subagent_id:null}})]),{status:201}));
  const output=[];
  for await(const e of provider.createSession(request))output.push(e);
  expect(output[0]?.rootTurnId).toBe('turn_fixture');
});

test('session create stays fixed-origin, authenticates session id, stops at completed root',async()=>{
  let url='',init:RequestInit={};
  const response=new Response(stream([
    event({type:'agent.session.idle',session_id:sid}),
    event({type:'agent.session.turn.completed',session_id:sid,turn:{id:tid,subagent_id:null}})
  ]),{status:200});
  const provider=new OpenAIHostedStreamingProvider('fixture-key',async(u,o)=>{
    url=u;init=o;return response;
  });
  const packets=[];
  for await(const item of provider.createSession(request))packets.push(item);
  expect(packets).toHaveLength(2);
  expect(packets[1]?.rootTurnId).toBe(tid);
  expect(url).toBe('https://api.openai.com/v1/agents/sessions');
  expect(init.method).toBe('POST');
  expect(init.redirect).toBe('error');
  expect(init.headers).toMatchObject({'OpenAI-Beta':'agents=v1',Authorization:'Bearer fixture-key'});
  expect(JSON.stringify(init.body)).not.toContain('fixture-key');
});
test('rejects missing or switched session IDs without leaking API details',async()=>{
  const missing=new OpenAIHostedStreamingProvider('key',async()=>new Response(stream([
    event({type:'agent.session.idle'})
  ]),{status:200}));
  await expect(async()=>{
    for await(const _ of missing.createSession(request)){void _;}
  }).rejects.toThrow('hosted-stream-missing-session');
  const changed=new OpenAIHostedStreamingProvider('key',async()=>new Response(stream([
    event({type:'agent.session.idle',session_id:sid}),
    event({type:'agent.session.idle',session_id:'sess_other'})
  ]),{status:200}));
  await expect(async()=>{
    for await(const _ of changed.createSession(request)){void _;}
  }).rejects.toThrow('hosted-stream-session-switch');
});
test('disconnect, missing completed turn ID and provider 429 always fail closed',async()=>{
  const disconnected=new OpenAIHostedStreamingProvider('key',async()=>new Response(stream([
    event({type:'agent.session.idle',session_id:sid})
  ]),{status:200}));
  await expect(async()=>{for await(const _ of disconnected.createSession(request)){void _;}})
    .rejects.toThrow('hosted-stream-disconnected');
  const missingId=new OpenAIHostedStreamingProvider('key',async()=>new Response(stream([
    event({type:'agent.session.turn.completed',session_id:sid,turn:{subagent_id:null}})
  ]),{status:200}));
  await expect(async()=>{for await(const _ of missingId.createSession(request)){void _;}})
    .rejects.toThrow('hosted-stream-root-id');
  const denied=new OpenAIHostedStreamingProvider('key',async()=>
    new Response('provider private body',{status:429}));
  let error='';
  try{for await(const _ of denied.createSession(request)){void _;}}catch(e){error=String(e);}
  expect(error).toContain('hosted-create-failed');
  expect(error).not.toContain('provider private body');
});
test('SSE parser rejects invalid event content and oversized stream',async()=>{
  await expect(async()=>{for await(const _ of parseAgentSse(stream(['data: bad-json\n\n']))){void _;}})
    .rejects.toThrow('hosted-stream-json');
  await expect(async()=>{for await(const _ of parseAgentSse(stream(['data: x'.repeat(3000)]),100)){void _;}})
    .rejects.toThrow('hosted-stream-total');
});
