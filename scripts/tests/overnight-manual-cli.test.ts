import {expect,test,vi} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {manualCli} from '../overnight-manual.ts';
import {signaturePayload} from '../overnight-policy.ts';
import {sha256,REPOSITORY} from '../codex-automation-policy.ts';
import {emptyLedger} from '../overnight-ledger.ts';
import {manifest,trigger} from './overnight-fixture.ts';
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'manual-owner-')),statePath=join(root,'github.json'),gh=join(root,'gh'),source=join(root,'original.json'),keyPath=join(root,'owner.pem'),output=join(root,'prepared.json');
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),m=manifest(1);
  const enrollment={publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString(),fingerprint:sha256(publicKey.export({type:'spki',format:'der'})),revoked:false};
  const config={version:1,enabled:true,enrollment,manifest:m,signature:sign(null,Buffer.from(signaturePayload(m)),privateKey).toString('base64')};
  writeFileSync(keyPath,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  const content=Buffer.from(JSON.stringify(config)).toString('base64');writeFileSync(source,JSON.stringify({branch:'sovereign-overnight-config-v1',content,sha:'c'.repeat(40)}));
  const state={manualSource:readFileSync(new URL('../overnight-manual.ts',import.meta.url),'utf8'),main:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),remote:{sha:'c'.repeat(40),content},config,ledger:emptyLedger(),calls:[] as string[][],dispatches:0,failDispatch:false};
  writeFileSync(statePath,JSON.stringify(state));
  writeFileSync(gh,`#!${process.execPath}
const fs=require('node:fs');const path=${JSON.stringify(statePath)};
const s=JSON.parse(fs.readFileSync(path,'utf8')),args=process.argv.slice(2);s.calls.push(args);
let reply={};const route=args[1],root='repos/${REPOSITORY}';
if(args[0]==='variable'){}else if(args[0]==='workflow'){s.dispatches++;}
else if(args[0]==='api'&&args[1]==='--method'){
 const r=JSON.parse(fs.readFileSync(0,'utf8'));if(r.sha!==s.remote.sha)process.exit(2);
 s.remote={sha:'d'.repeat(40),content:r.content};
}else if(route==='user')reply={login:'${trigger.actor}',id:${trigger.actorId}};
else if(route===root+'/actions/variables/SOVEREIGN_OWNER_KEY_SHA256')reply={value:s.config.enrollment.fingerprint};
else if(route===root+'/git/ref/heads/main')reply={ref:'refs/heads/main',object:{sha:s.main}};
else if(route.includes('/collaborators/'))reply={permission:'admin',user:{login:'${trigger.actor}',id:${trigger.actorId},type:'User'}};
else if(route.includes('/contents/scripts/overnight-manual.ts'))reply={content:Buffer.from(s.manualSource).toString('base64')};
else if(route.includes('/contents/.sovereign/queue.json'))reply=s.remote;
else if(route.includes('/contents/.sovereign/overnight-ledger.json'))reply={content:Buffer.from(JSON.stringify(s.ledger)).toString('base64')};
else if(route===root+'/issues/101')reply={number:101,state:'open',title:s.config.manifest.tasks[0].title,body:'Frozen issue body'};
else process.exit(3);
fs.writeFileSync(path,JSON.stringify(s));if(args[0]==='workflow'&&s.failDispatch)process.exit(1);
process.stdout.write(JSON.stringify(reply));
`,{mode:0o700});
  const old=process.env.SOVEREIGN_GH;process.env.SOVEREIGN_GH=gh;
  const read=()=>JSON.parse(readFileSync(statePath,'utf8')) as typeof state;
  return {source,keyPath,output,statePath,read,cleanup(){if(old===undefined)delete process.env.SOVEREIGN_GH;else process.env.SOVEREIGN_GH=old;rmSync(root,{recursive:true,force:true})}};
}
test('owner-local preparation signs without GitHub writes or exposing the private key',async()=>{
  const f=fixture(),out=vi.spyOn(console,'log').mockImplementation(()=>{});
  try{
    await manualCli(['prepare',f.source,f.keyPath,f.output,'--platform-limit-50']);
    const request=JSON.parse(readFileSync(f.output,'utf8')),config=JSON.parse(Buffer.from(request.content,'base64').toString('utf8'));
    expect(config.manifest).toMatchObject({version:2,softLimitUsd:50,tasks:[{codingSeconds:null,maxSessions:1}]});
    expect(f.read().calls.every(args=>args[0]==='api'&&args[1]!=='--method')).toBe(true);
    expect(JSON.stringify(f.read().calls)).not.toContain(f.keyPath);
    expect(readFileSync(f.output,'utf8')).not.toContain('PRIVATE KEY');
    await expect(manualCli(['prepare',f.source,f.keyPath,f.output,'--platform-limit-50'])).rejects.toThrow();
  }finally{out.mockRestore();f.cleanup()}
});
test.each([false,true])('one owner launch publishes exact bytes and never retries uncertain dispatch=%s',async failDispatch=>{
  const f=fixture(),out=vi.spyOn(console,'log').mockImplementation(()=>{});
  try{
    await manualCli(['prepare',f.source,f.keyPath,f.output,'--platform-limit-50']);
    const state=f.read();state.failDispatch=failDispatch;writeFileSync(f.statePath,JSON.stringify(state));
    const started=manualCli(['start',f.output,'--platform-limit-50']);
    if(failDispatch)await expect(started).rejects.toThrow();else await started;
    expect(existsSync(f.output+'.attempted')).toBe(true);expect(f.read().dispatches).toBe(1);
    expect(f.read().calls).toContainEqual(['variable','set','SOVEREIGN_OVERNIGHT_SCHEDULE_ENABLED','--body','false','--repo',REPOSITORY]);
    expect(f.read().calls).toContainEqual(['workflow','run','sovereign-overnight-queue.yml','--repo',REPOSITORY,'--ref','main','--field','mode=execute']);
    const writes=f.read().calls.filter(args=>args[0]!=='api'||args[1]==='--method').length;
    await expect(manualCli(['start',f.output,'--platform-limit-50'])).rejects.toThrow();
    expect(f.read().dispatches).toBe(1);
    expect(f.read().calls.filter(args=>args[0]!=='api'||args[1]==='--method')).toHaveLength(writes);
  }finally{out.mockRestore();f.cleanup()}
});
test('owner must attest to the enforced Platform spend setting; missing attestation does nothing',async()=>{
  const f=fixture();try{await expect(manualCli(['prepare',f.source,f.keyPath,f.output])).rejects.toThrow('manual-usage');expect(f.read().calls).toEqual([])}finally{f.cleanup()}
});
test('main drift between preparation and bedtime blocks all publication/dispatch mutations',async()=>{
  const f=fixture(),out=vi.spyOn(console,'log').mockImplementation(()=>{});
  try{
    await manualCli(['prepare',f.source,f.keyPath,f.output,'--platform-limit-50']);
    const state=f.read();state.main='e'.repeat(40);writeFileSync(f.statePath,JSON.stringify(state));
    await expect(manualCli(['start',f.output,'--platform-limit-50'])).rejects.toThrow('manual-config-or-main-changed');
    expect(f.read().dispatches).toBe(0);expect(existsSync(f.output+'.attempted')).toBe(false);
    expect(f.read().calls.every(args=>args[0]==='api'&&args[1]!=='--method')).toBe(true);
  }finally{out.mockRestore();f.cleanup()}
});
