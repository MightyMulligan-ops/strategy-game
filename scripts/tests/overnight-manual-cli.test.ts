import {expect,test,vi} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {manualCli,type ManualCommand} from '../overnight-manual.ts';
import {canonical,issueDigest,parseManifest,OWNER_ID} from '../overnight-policy.ts';
import {sha256,REPOSITORY,OWNER} from '../codex-automation-policy.ts';
import {emptyLedger,QueueJournal} from '../overnight-ledger.ts';
import {MemoryStore} from './overnight-fixture.ts';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'manual-launch-')),input=join(root,'task.json'),key=join(root,'owner.pem'),output=join(root,'prepared.json');
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),main='a'.repeat(40),now=new Date('2026-11-19T03:00:00.000Z');
 const enrollment={publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString(),fingerprint:sha256(publicKey.export({type:'spki',format:'der'})),revoked:false};
 const body='Owner-approved city recruitment task',title='City recruitment';
 const request={issue:110,title,issueDigest:issueDigest(title,body),scopeText:body,sourceSha:main,allowedPaths:['database/prisma/schema.prisma','apps/web/src/CityPanel.tsx']};
 writeFileSync(input,JSON.stringify(request));writeFileSync(key,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 const remoteFile=(value:unknown,sha='b'.repeat(40))=>({sha,content:Buffer.from(JSON.stringify(value)).toString('base64')});
 const state={main,owner:OWNER,ownerId:OWNER_ID,pin:enrollment.fingerprint,ledger:emptyLedger(),remote:remoteFile({version:1,enabled:false,enrollment}),
  source:readFileSync(new URL('../overnight-manual.ts',import.meta.url)),scopePaths:request.allowedPaths,body,title,dispatches:0,failDispatch:false,failPut:false,corruptPublished:false};
 const calls:{parts:string[];body?:string}[]=[];
 const command:ManualCommand=(parts,data)=>{
  calls.push({parts,...(data===undefined?{}:{body:data})});const route=parts[1],base='repos/'+REPOSITORY;
  if(parts[0]==='variable')return '';
  if(parts[0]==='workflow'){state.dispatches++;if(state.failDispatch)throw Error('lost dispatch');return ''}
  if(parts[0]==='api'&&route==='--method'){
   const p=JSON.parse(data!);expect(p.sha).toBe(state.remote.sha);
   state.remote={sha:'c'.repeat(40),content:state.corruptPublished?'not-the-signed-bytes':p.content};
   if(state.failPut)throw Error('lost put');return '{}';
  }
  if(route==='user')return JSON.stringify({login:state.owner,id:state.ownerId});
  if(route===base+'/git/ref/heads/main')return JSON.stringify({ref:'refs/heads/main',object:{sha:state.main}});
  if(route?.includes('/collaborators/'))return JSON.stringify({permission:'admin',user:{login:OWNER,id:OWNER_ID,type:'User'}});
  if(route?.includes('/contents/scripts/overnight-manual.ts'))return JSON.stringify({content:state.source.toString('base64')});
  if(route?.includes('/contents/docs/CITY_RECRUITMENT_SCOPE.json'))return JSON.stringify(remoteFile({version:1,issue:110,allowedPaths:state.scopePaths}));
  if(route?.includes('/actions/variables/'))return JSON.stringify({value:state.pin});
  if(route?.includes('/contents/.sovereign/queue.json'))return JSON.stringify(state.remote);
  if(route?.includes('/contents/.sovereign/overnight-ledger.json'))return JSON.stringify(remoteFile(state.ledger));
  if(route===base+'/issues/110')return JSON.stringify({number:110,state:'open',title:state.title,body:state.body});
  throw Error('Unexpected route '+route);
 };
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 const run=(args:readonly string[])=>manualCli(args,{repo:root,command,head:()=>main,now:()=>now,nonce:()=> 'fixture-one'});
 const prepare=()=>run(['prepare',input,key,output,'--soft-limit-50']);
 const start=()=>run(['start',output,'--soft-limit-50']);
 const prepared=()=>JSON.parse(Buffer.from(JSON.parse(readFileSync(output,'utf8')).content,'base64').toString('utf8'));
 const mutations=()=>calls.filter(c=>c.parts[0]!=='api'||c.parts[1]==='--method');
 return {root,input,key,output,state,calls,request,run,prepare,start,prepared,mutations,cleanup(){log.mockRestore();rmSync(root,{recursive:true,force:true})}};
}
test('prepare signs a fresh exact issue/source/profile without remote writes or private-key disclosure',async()=>{
 const f=fixture();try{
  await f.prepare();const c=f.prepared(),parsed=parseManifest(Buffer.from(JSON.stringify(c.manifest)));
  expect(parsed).toMatchObject({execution:{model:'gpt-6.2-astra',softLimitMicroUsd:50000000},tasks:[{codingSeconds:18000,maxSessions:1}]});
  expect(f.mutations()).toHaveLength(0);expect(readFileSync(f.output,'utf8')).not.toContain('PRIVATE KEY');
  expect(JSON.stringify(f.calls)).not.toContain(f.key);expect(c.signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
  await expect(f.prepare()).rejects.toThrow();
 }finally{f.cleanup()}
});
test('start publishes exact bytes then dispatches once, and records its marker before mutation',async()=>{
 const f=fixture();try{
  await f.prepare();await f.start();expect(f.state.dispatches).toBe(1);expect(existsSync(f.output+'.attempted')).toBe(true);
  const put=f.mutations().find(c=>c.parts[1]==='--method');expect(put).toBeDefined();
  expect(f.state.remote.content).toBe(JSON.parse(readFileSync(f.output,'utf8')).content);
  const before=f.calls.length;await expect(f.start()).rejects.toThrow('manual-attempt-already-recorded');expect(f.calls).toHaveLength(before);
 }finally{f.cleanup()}
});
test.each(['dispatch','put'])('lost %s response is not retried',async kind=>{
 const f=fixture();try{
  await f.prepare();if(kind==='dispatch')f.state.failDispatch=true;else f.state.failPut=true;
  await expect(f.start()).rejects.toThrow();const before=f.calls.length;
  await expect(f.start()).rejects.toThrow('manual-attempt-already-recorded');expect(f.calls).toHaveLength(before);
  expect(f.state.dispatches).toBe(kind==='dispatch'?1:0);
 }finally{f.cleanup()}
});
test.each(['owner','pin','source','main','issue'])('preparation rejects %s drift without mutation',async kind=>{
 const f=fixture();try{
  if(kind==='owner')f.state.owner='someone-else';
  if(kind==='pin')f.state.pin='0'.repeat(64);
  if(kind==='source')f.state.source=Buffer.from('different launcher');
  if(kind==='main')f.state.main='d'.repeat(40);
  if(kind==='issue')f.state.body='changed approval';
  await expect(f.prepare()).rejects.toThrow();expect(f.mutations()).toHaveLength(0);expect(existsSync(f.output)).toBe(false);
 }finally{f.cleanup()}
});
test.each(['config','issue','signature','scope'])('start rejects %s drift before marker/mutation',async kind=>{
 const f=fixture();try{
  await f.prepare();
  if(kind==='config')f.state.remote.sha='d'.repeat(40);
  if(kind==='issue')f.state.body='changed issue';
  if(kind==='signature'||kind==='scope'){
   const p=JSON.parse(readFileSync(f.output,'utf8')),c=f.prepared();
   if(kind==='signature')c.signature=Buffer.alloc(64).toString('base64');else c.manifest.tasks[0].allowedPaths=['scripts/controller.ts'];
   p.content=Buffer.from(JSON.stringify(c)).toString('base64');writeFileSync(f.output,JSON.stringify(p));
  }
  await expect(f.start()).rejects.toThrow();expect(f.mutations()).toHaveLength(0);expect(existsSync(f.output+'.attempted')).toBe(false);
 }finally{f.cleanup()}
});
test('active durable claim prevents another launch',async()=>{
 const f=fixture();try{
  await f.prepare();const store=new MemoryStore();await new QueueJournal(store).reserve(f.prepared().manifest,'123',new Date('2026-11-19T03:00:00.000Z'));
  f.state.ledger=store.ledger;await expect(f.start()).rejects.toThrow('manual-active-or-uncertain-run');expect(f.mutations()).toHaveLength(0);
 }finally{f.cleanup()}
});
test('mismatched published bytes prevent enable/dispatch and preserve the attempted marker',async()=>{
 const f=fixture();try{
  await f.prepare();f.state.corruptPublished=true;await expect(f.start()).rejects.toThrow('manual-publication-mismatch');
  expect(f.state.dispatches).toBe(0);expect(existsSync(f.output+'.attempted')).toBe(true);
  expect(f.calls.some(c=>c.parts[0]==='variable'&&c.parts.includes('true'))).toBe(false);
 }finally{f.cleanup()}
});
test('preparation requires the explicit soft-limit flag and exact frozen input',async()=>{
 const f=fixture();try{
  await expect(f.run(['prepare',f.input,f.key,f.output,'--anything'])).rejects.toThrow('manual-usage');
  writeFileSync(f.input,JSON.stringify({...f.request,extra:'unapproved'}));await expect(f.prepare()).rejects.toThrow('manual-frozen-input');
  expect(f.mutations()).toHaveLength(0);expect(canonical(f.state.ledger)).toContain('"active":null');
 }finally{f.cleanup()}
});

test('freeze writes current source and exact issue/path metadata without signature or mutation',async()=>{
 const f=fixture();try{
  const output=join(f.root,'frozen.json');await f.run(['freeze','110',output,'--soft-limit-50']);
  const task=JSON.parse(readFileSync(output,'utf8'));expect(task).toMatchObject(f.request);
  expect(task).not.toHaveProperty('signature');expect(f.mutations()).toHaveLength(0);
  await expect(f.run(['freeze','110',output,'--soft-limit-50'])).rejects.toThrow();
 }finally{f.cleanup()}
});
test('freeze rejects controller paths and unrelated issues',async()=>{
 const f=fixture();try{
  const output=join(f.root,'frozen.json');f.state.scopePaths=['scripts/controller.ts'];
  await expect(f.run(['freeze','110',output,'--soft-limit-50'])).rejects.toThrow('manual-frozen-paths');
  await expect(f.run(['freeze','95',output,'--soft-limit-50'])).rejects.toThrow('manual-approved-issue');
  expect(existsSync(output)).toBe(false);expect(f.mutations()).toHaveLength(0);
 }finally{f.cleanup()}
});
