/** Trusted validator/publisher contract. A replay receipt is NOT test evidence.
 * Authenticity comes from the digest passed through Actions needs/outputs,
 * never from a digest, status or receipt supplied by generated code. */
import {canonicalScope,sha256,REPOSITORY,validScopePath,SHA,DIGEST,validateProposal,type TaskScope} from './codex-automation-policy.ts';
import {requireControl} from './codex-run-control.ts';

export const VALIDATION_POLICY='isolated-checks-v1';
export const PNPM_VERSION='12.18.0';
export const REQUIRED_CHECKS=['build','typecheck','test','lint'] as const;
export type RequiredCheck=typeof REQUIRED_CHECKS[number];
export type CheckSuccess=Readonly<{command:RequiredCheck;status:'passed';exitCode:0}>;
export type ReplayReceipt=Readonly<{tree_sha:string;source_sha:string;scope_digest:string;patch_sha256:string;
  paths:readonly string[];result:'RECONSTRUCTED_NO_EXECUTION'}>;
export type ValidationBundle=Readonly<{scope:Uint8Array;manifest:Uint8Array;patch:Uint8Array;summary:Uint8Array;replay:Uint8Array}>;
export type ValidationContext=Readonly<{runId:string;sourceSha:string}>;
export type ValidationReceipt=Readonly<{
  version:1;policy:typeof VALIDATION_POLICY;repository:typeof REPOSITORY;runId:string;runAttempt:1;
  sourceSha:string;treeSha:string;imageId:string;pnpmVersion:typeof PNPM_VERSION;network:'none';
  checks:readonly CheckSuccess[];artifacts:Readonly<Record<keyof ValidationBundle,string>>;
}>;
function shape(value:unknown,keys:readonly string[]):Record<string,unknown>{
  requireControl(value!==null&&typeof value==='object'&&!Array.isArray(value),'validation-receipt-shape');
  const obj=value as Record<string,unknown>;
  requireControl(Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k)),'validation-receipt-shape');
  return obj;
}
export function parseJson(bytes:Uint8Array,max=64*1024):unknown{
  requireControl(bytes.byteLength>0&&bytes.byteLength<=max,'validation-artifact-size');
  try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}
  catch{throw Error('validation-artifact-json');}
}
export function verifyReplayReceipt(value:unknown,scope:TaskScope,patch:Uint8Array):ReplayReceipt{
  const r=shape(value,['tree_sha','source_sha','scope_digest','patch_sha256','paths','result']);
  requireControl(typeof r.source_sha==='string'&&SHA.test(r.source_sha)&&typeof r.tree_sha==='string'&&SHA.test(r.tree_sha)&&
    r.source_sha===scope.sourceSha&&r.scope_digest===sha256(canonicalScope(scope))&&r.patch_sha256===sha256(patch)&&
    r.result==='RECONSTRUCTED_NO_EXECUTION'&&Array.isArray(r.paths)&&r.paths.length>=1&&r.paths.length<=25&&
    r.paths.every(p=>typeof p==='string'&&validScopePath(p,scope.profile)&&scope.approvedPaths.includes(p))&&
    new Set(r.paths).size===r.paths.length,'validation-replay-receipt');
  return r as ReplayReceipt;
}
export function verifyBundle(bundle:ValidationBundle){
  const scope=parseJson(bundle.scope,32*1024) as TaskScope&{scopeDigest:string};
  requireControl(scope.scopeDigest===sha256(canonicalScope(scope)),'validation-scope');
  const replay=verifyReplayReceipt(parseJson(bundle.replay),scope,bundle.patch);
  const decoder=new TextDecoder('utf8',{fatal:true});
  requireControl(validateProposal(scope,decoder.decode(bundle.manifest),bundle.patch,decoder.decode(bundle.summary)).length===0,'validation-proposal');
  return {scope,replay};
}
export function bundleDigests(bundle:ValidationBundle):Record<keyof ValidationBundle,string>{
  return {scope:sha256(bundle.scope),manifest:sha256(bundle.manifest),patch:sha256(bundle.patch),summary:sha256(bundle.summary),replay:sha256(bundle.replay)};
}
export function verifyChecks(value:unknown):asserts value is readonly CheckSuccess[]{
  requireControl(Array.isArray(value)&&value.length===REQUIRED_CHECKS.length,'validation-checks-incomplete');
  value.forEach((raw,i)=>{
    const c=shape(raw,['command','status','exitCode']);
    requireControl(c.command===REQUIRED_CHECKS[i]&&c.status==='passed'&&c.exitCode===0,'validation-check-not-passed');
  });
}
export function makeValidationReceipt(bundle:ValidationBundle,context:ValidationContext,imageId:string,checks:readonly CheckSuccess[]):ValidationReceipt{
  const {scope,replay}=verifyBundle(bundle);verifyChecks(checks);
  requireControl(/^\d+$/.test(context.runId)&&context.sourceSha===scope.sourceSha&&/^sha256:[a-f0-9]{64}$/.test(imageId),'validation-context');
  return {version:1,policy:VALIDATION_POLICY,repository:REPOSITORY,runId:context.runId,runAttempt:1,
    sourceSha:scope.sourceSha,treeSha:replay.tree_sha,imageId,pnpmVersion:PNPM_VERSION,network:'none',checks,artifacts:bundleDigests(bundle)};
}
/** Call BEFORE any publisher API request or write. The expected digest must be
 * supplied by trusted workflow metadata, not by the downloaded artifact. */
export function verifyValidationReceipt(bytes:Uint8Array,expectedDigest:unknown,context:ValidationContext,bundle:ValidationBundle):ValidationReceipt{
  requireControl(typeof expectedDigest==='string'&&DIGEST.test(expectedDigest)&&sha256(bytes)===expectedDigest,'validation-receipt-authenticity');
  const r=shape(parseJson(bytes),['version','policy','repository','runId','runAttempt','sourceSha','treeSha','imageId','pnpmVersion','network','checks','artifacts']);
  verifyChecks(r.checks);
  const expected=makeValidationReceipt(bundle,context,String(r.imageId),r.checks);
  requireControl(Object.entries(expected).filter(([k])=>k!=='checks'&&k!=='artifacts').every(([k,v])=>r[k]===v),'validation-receipt-context');
  const artifacts=shape(r.artifacts,Object.keys(expected.artifacts));
  requireControl(Object.entries(expected.artifacts).every(([k,v])=>artifacts[k]===v),'validation-receipt-artifacts');
  return expected;
}
