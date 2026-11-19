/** Controller-only best-effort cost guard. Never a provider billing ceiling.
 * Pinned standard-tier guard rates deliberately ignore cache discounts and use
 * long-context/cache-write rates plus the largest published container rate.
 * Reference: developers.openai.com/api/docs/models/gpt-6.2-astra and /pricing.
 */
import {requireControl} from './codex-run-control.ts';
import {HOSTED_MODEL} from './codex-hosted-agents.ts';
import {boundedBody,type PilotFetcher} from './codex-pilot-diagnostics.ts';
export const SOFT_LIMIT_MICRO_USD=50_000_000;
export type CostObservation={inputTokens:number;outputTokens:number;estimatedMicroUsd:number;observedAt:number};
export function estimateSessionCost(usage:unknown,elapsedMs:number,observedAt:number):CostObservation {
  requireControl(usage!==null&&typeof usage==='object'&&!Array.isArray(usage),'queue-usage-unavailable');
  const u=usage as Record<string,unknown>,input=u.input_tokens,output=u.output_tokens;
  requireControl(typeof input==='number'&&Number.isSafeInteger(input)&&input>=0&&
    typeof output==='number'&&Number.isSafeInteger(output)&&output>=0&&
    Number.isFinite(elapsedMs)&&elapsedMs>=0&&Number.isFinite(observedAt),'queue-usage-invalid');
  // $16 long-context input + $20 cache write per million; $60 output.
  // $1.92 per started 20-minute container interval. Not an exact invoice.
  const estimate=input*36+output*60+Math.max(1,Math.ceil(elapsedMs/1_200_000))*1_920_000;
  requireControl(Number.isSafeInteger(estimate),'queue-usage-overflow');
  return {inputTokens:input,outputTokens:output,estimatedMicroUsd:estimate,observedAt};
}
export async function verifyModelAccess(key:string,fetcher:PilotFetcher=fetch):Promise<void>{
  const r=await fetcher('https://api.openai.com/v1/models/'+HOSTED_MODEL,{method:'GET',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key}});
  requireControl(r.status===200,'queue-model-unavailable');
  const v=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await boundedBody(r,65536))) as Record<string,unknown>;
  requireControl(v.id===HOSTED_MODEL,'queue-model-mismatch');
}
export async function observeSessionCost(key:string,id:string,elapsedMs:number,fetcher:PilotFetcher=fetch,now=Date.now()):Promise<CostObservation>{
  const r=await fetcher('https://api.openai.com/v1/agents/sessions/'+id,{method:'GET',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key,'OpenAI-Beta':'agents=v1'}});
  requireControl(r.status===200,'queue-usage-http');
  const v=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await boundedBody(r,65536))) as Record<string,unknown>;
  const a=v.agent as Record<string,unknown>|undefined;
  requireControl(v.id===id&&a?.model===HOSTED_MODEL,'queue-usage-identity');
  return estimateSessionCost(v.usage,elapsedMs,now);
}
