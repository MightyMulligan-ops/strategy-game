import {test,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalScope,sha256,REPOSITORY,type TaskScope} from '../codex-automation-policy.ts';
import {verifyReceipt,VerifiedProposalPublisher,type ValidationReceipt} from '../codex-proposal-publisher.ts';
import {RunController,type RunLedger,type LedgerStore,type LaunchEvidence} from '../codex-run-control.ts';
import type {GitHubTransport,GitHubReply} from '../codex-github-control.ts';

const scope:TaskScope={repository:REPOSITORY,issue:76,sourceSha:'a'.repeat(40),baseSha:'a'.repeat(40),approvedPaths:['packages/game-engine/src/combat.ts'],
  acceptanceDigest:'b'.repeat(64),expiresAt:'2026-11-15T00:00:00Z'};
const files=[{path:scope.approvedPaths[0]!,content:Buffer.from('export const fixture = 1;\n')}];
const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({format:'pem',type:'spki'}).toString();
const now=new Date('2026-11-14T20:00:00Z');
const receipt:ValidationReceipt={version:1,sourceSha:scope.sourceSha,sourceTreeSha:'c'.repeat(40),treeSha:'d'.repeat(40),
  scopeDigest:sha256(canonicalScope(scope)),runId:'run-1',testedAt:'2026-11-14T19:59:00Z',expiresAt:'2026-11-14T20:05:00Z',
  checks:['build','typecheck','lint','db-free-tests'],files:[{path:files[0]!.path,bytes:files[0]!.content.length,sha256:sha256(files[0]!.content)}]};
function signed(r:ValidationReceipt=receipt){const text=JSON.stringify(r);return {text,signature:sign(null,Buffer.from(text),keys.privateKey).toString('base64')};}
test('signed isolated-validator receipt binds source, complete tree, file bytes, checks and expiry',()=>{
  const s=signed();expect(verifyReceipt(s.text,s.signature,publicKey,scope,'run-1',files,now).treeSha).toBe(receipt.treeSha);
});
test('tampered receipts, wrong keys, expired checks and modified content are rejected',()=>{
  const s=signed();const other=generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}).toString();
  expect(()=>verifyReceipt(s.text+' ',s.signature,publicKey,scope,'run-1',files,now)).toThrow();
  expect(()=>verifyReceipt(s.text,s.signature,other,scope,'run-1',files,now)).toThrow();
  expect(()=>verifyReceipt(s.text,s.signature,publicKey,scope,'run-1',files,new Date('2026-11-14T21:00:00Z'))).toThrow();
  expect(()=>verifyReceipt(s.text,s.signature,publicKey,scope,'run-1',[{...files[0]!,content:Buffer.from('malicious replacement')}],now)).toThrow();
  const bad=signed({...receipt,checks:['build'] as unknown as ValidationReceipt['checks']});
  expect(()=>verifyReceipt(bad.text,bad.signature,publicKey,scope,'run-1',files,now)).toThrow();
});
async function setup(){
  let revision=0;let state:RunLedger={version:1,project:'proj_fixture',months:[{month:'2026-11',baselineMicroUsd:1000000,safetyMarginMicroUsd:1000000}],runs:[]};
  const store:LedgerStore={read:async()=>({revision:String(revision),ledger:structuredClone(state)}),
    compareAndSwap:async(r,l)=>{if(r!==String(revision))return false;state=structuredClone(l);revision++;return true;}};
  const ledger=new RunController(store,'proj_fixture');await ledger.claim(scope,'run-1','2026-11',1000000);await ledger.stop('run-1','finished');
  const calls:{method:string;path:string;body:unknown}[]=[];let wrongTree=false;let duplicate=false;let failPr=false;
  const api:GitHubTransport={request:async(method,path,body):Promise<GitHubReply>=>{
    calls.push({method,path,body});
    if(method==='GET'&&path.startsWith('/pulls?'))return {status:200,data:duplicate?[{number:1}]:[]};
    if(method==='GET')return {status:200,data:{tree:{sha:receipt.sourceTreeSha}}};
    if(path==='/git/trees')return {status:201,data:{sha:wrongTree?'f'.repeat(40):receipt.treeSha}};
    if(path==='/git/commits')return {status:201,data:{sha:'e'.repeat(40)}};
    if(path==='/git/refs')return {status:201,data:{}};
    if(path==='/pulls'){if(failPr)throw Error('ambiguous network fixture');return {status:201,data:{number:81,draft:true}};}
    throw Error('unexpected fixture path');
  }};
  const admission={check:async():Promise<LaunchEvidence>=>({project:'proj_fixture',runId:'run-1',grantDigest:receipt.scopeDigest,
    now:now.toISOString(),exclusiveProjectRouting:true,keyProjectBindingVerified:true,isolatedWorkerVerified:true,immutableToolchainVerified:true,runtimeObservedAt:'2026-11-14T20:00:00Z',runMaxMicroUsd:1000000})};
  return {publisher:new VerifiedProposalPublisher(api,admission,ledger,publicKey),calls,state:()=>state,
    wrongTree:()=>{wrongTree=true;},duplicate:()=>{duplicate=true;},failPr:()=>{failPr=true;}};
}
test('publisher writes only exact verified Git objects, a dedicated branch and a draft PR',async()=>{
  const x=await setup();const s=signed();expect(await x.publisher.publish(scope,'run-1',s.text,s.signature,files,now)).toBe(81);
  expect(x.calls.filter(c=>c.method!=='GET').map(c=>c.path)).toEqual(['/git/trees','/git/commits','/git/refs','/pulls']);
  expect(x.calls.find(c=>c.path==='/pulls')?.body).toMatchObject({draft:true,base:'main',head:'issue/76-codex-pilot'});
  expect(x.state().runs[0]!.publication?.state).toBe('published');
});
test('reconstructed tree mismatch cannot write a branch or PR',async()=>{
  const x=await setup();x.wrongTree();const s=signed();await expect(x.publisher.publish(scope,'run-1',s.text,s.signature,files,now)).rejects.toThrow();
  expect(x.calls.filter(c=>c.method!=='GET').map(c=>c.path)).toEqual(['/git/trees']);
});
test('existing PR blocks all publication writes',async()=>{
  const x=await setup();x.duplicate();const s=signed();await expect(x.publisher.publish(scope,'run-1',s.text,s.signature,files,now)).rejects.toThrow();
  expect(x.calls.every(c=>c.method==='GET')).toBe(true);
});
test('ambiguous PR creation retains publication claim and never automatically repeats a write',async()=>{
  const x=await setup();x.failPr();const s=signed();await expect(x.publisher.publish(scope,'run-1',s.text,s.signature,files,now)).rejects.toThrow();
  await expect(x.publisher.publish(scope,'run-1',s.text,s.signature,files,now)).rejects.toThrow('publication-already-claimed');
  expect(x.calls.filter(c=>c.path==='/pulls')).toHaveLength(1);
});
