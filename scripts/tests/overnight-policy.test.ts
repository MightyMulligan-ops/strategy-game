import {expect,test,vi} from 'vitest';
import {parseManifest,easternStart,QueueAuthority,manifestDigest} from '../overnight-policy.ts';
import {manifest,signature,enrollment,trigger,api,bytes,now,resignTask} from './overnight-fixture.ts';
test('shipped configuration is inert and needs neither approval nor network',async()=>{
  const {readFileSync}=await import('node:fs');const raw=readFileSync(new URL('../../config/overnight-queue.disabled.json',import.meta.url));
  const request=vi.fn();const authority=new QueueAuthority({request},enrollment,raw,Buffer.alloc(0),trigger);
  expect(await authority.check(now,true)).toEqual({version:1,repository:trigger.repository,enabled:false,tasks:[]});expect(request).not.toHaveBeenCalled();
});
test('valid signed owner manifest freezes exact sequence, scope and paths',async()=>{
  const m=manifest();expect(await new QueueAuthority(api(m),enrollment,bytes(m),signature(m),trigger).check(now,true)).toEqual(m);
  expect(manifestDigest(parseManifest(bytes(m)) as typeof m)).toHaveLength(64);
});
test.each(['signature','key','permission','actor','actor-id','attempt','baseline','issue-body','issue-title','closed','pull-request','deleted-issue','unavailable'])(
  'fails closed on %s authority failure',async(kind)=>{
    const m=manifest(),base=api(m),request=vi.fn(async(...args:Parameters<typeof base.request>)=>{
      const result=await base.request(...args),[,_path]=args;
      if(kind==='permission'&&_path.includes('/permission'))return {status:200,data:{permission:'write',user:{login:trigger.actor,id:trigger.actorId,type:'User'}}};
      if(_path==='/issues/101'){
        if(kind==='issue-body')return {...result,data:{...result.data as object,body:'Changed'}};
        if(kind==='issue-title')return {...result,data:{...result.data as object,title:'Changed'}};
        if(kind==='closed')return {...result,data:{...result.data as object,state:'closed'}};
        if(kind==='pull-request')return {...result,data:{...result.data as object,pull_request:{}}};
        if(kind==='deleted-issue')return {status:404,data:{}};
      }
      if(kind==='unavailable')return {status:403,data:{}};
      return result;
    });
    const e={...trigger,...(kind==='actor'?{actor:'contributor'}:{}),...(kind==='actor-id'?{actorId:123}:{}),...(kind==='attempt'?{attempt:2}:{}),...(kind==='baseline'?{sourceSha:'f'.repeat(40)}:{})};
    await expect(new QueueAuthority({request},kind==='key'?{...enrollment,fingerprint:'0'.repeat(64)}:enrollment,bytes(m),kind==='signature'?Buffer.alloc(64):signature(m),e).check(now,true)).rejects.toThrow();
  });
test.each([0,4])('rejects %i tasks',count=>expect(()=>parseManifest(bytes({...manifest(),tasks:manifest(count).tasks}))).toThrow());
test.each(['paths','scope','order','window','baseline'])('signature binds %s independently of a recomputed digest',async(kind)=>{
  const original=manifest(),m=structuredClone(original);
  if(kind==='paths')m.tasks=[resignTask(m.tasks[0]!,{allowedPaths:['apps/server/src/other.ts']}),...m.tasks.slice(1)];
  if(kind==='scope')m.tasks=[resignTask(m.tasks[0]!,{scopeText:'Expanded scope'}),...m.tasks.slice(1)];
  if(kind==='order')m.tasks=[...m.tasks].reverse();
  if(kind==='window')m.endsAt='2026-11-17T07:00:00.000Z';
  if(kind==='baseline')m.baselineSha='e'.repeat(40);
  await expect(new QueueAuthority(api(m),enrollment,bytes(m),signature(original),{...trigger,sourceSha:m.baselineSha}).check(now,true)).rejects.toThrow('queue-owner-signature');
});
test.each(['.github/workflows/x.yml','scripts/controller.ts','apps/server/../secret.ts','apps/server/src/.env.ts','apps/server/package.json','database/src/x.ts'])(
  'existing coding policy rejects path %s',path=>{
    const m=manifest(1);m.tasks=[resignTask(m.tasks[0]!,{allowedPaths:[path]})];expect(()=>parseManifest(bytes(m))).toThrow();
  });
test.each(['sessions','runtime','issue76','duplicate-issue','duplicate-approval','digest','forbidden','extra'])(
  'restricts %s',kind=>{
    const m=structuredClone(manifest());
    if(kind==='sessions')m.tasks=[resignTask(m.tasks[0]!,{maxSessions:2 as 1})];
    if(kind==='runtime')m.tasks=[resignTask(m.tasks[0]!,{codingSeconds:1800})];
    if(kind==='issue76')m.tasks=[resignTask(m.tasks[0]!,{issue:76})];
    if(kind==='duplicate-issue')m.tasks=[m.tasks[0]!,resignTask(m.tasks[1]!,{issue:m.tasks[0]!.issue})];
    if(kind==='duplicate-approval')m.tasks=[m.tasks[0]!,resignTask(m.tasks[1]!,{approvalId:m.tasks[0]!.approvalId})];
    if(kind==='digest')m.tasks=[{...m.tasks[0]!,approvalDigest:'0'.repeat(64)}];
    if(kind==='forbidden')m.forbiddenOperations=[];
    const v=kind==='extra'?{...m,ownerApproved:true}:m;expect(()=>parseManifest(bytes(v))).toThrow();
  });
test.each([
  ['2026-03-07','2026-03-08T03:30:00.000Z'],['2026-03-08','2026-03-09T02:30:00.000Z'],
  ['2026-10-31','2026-11-01T02:30:00.000Z'],['2026-11-01','2026-11-02T03:30:00.000Z'],
])('Eastern 22:30 maps once across DST: %s',(date,utc)=>expect(easternStart(date)).toBe(utc));
test.each(['2026-02-30','2026-13-01','2026-1-01','not-a-date'])('rejects invalid local date %s',date=>expect(()=>easternStart(date)).toThrow());
test.each(['2026-11-17T03:29:59.999Z','2026-11-17T03:45:00.000Z','2026-11-18T03:30:00.000Z'])(
  'early/late/stale dispatch rejected at %s',async(time)=>{
    const m=manifest();await expect(new QueueAuthority(api(m),enrollment,bytes(m),signature(m),trigger).check(new Date(time),true)).rejects.toThrow('queue-expired-or-late');
  });
test('schedule still requires the signed one-night window and denies later-day replay',async()=>{
  const m=manifest(),a=new QueueAuthority(api(m),enrollment,bytes(m),signature(m),{...trigger,event:'schedule'});
  expect((await a.check(now,true)).enabled).toBe(true);
  await expect(a.check(new Date(now.getTime()+86400000),true)).rejects.toThrow();
});
