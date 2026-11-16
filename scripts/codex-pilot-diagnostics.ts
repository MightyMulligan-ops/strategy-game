/** Trusted diagnostic allowlist. Never serialize Error, request/response bodies,
 * arbitrary provider messages, headers, model output, or credentials. */
import {randomUUID} from 'node:crypto';
import {ControlDenied} from './codex-run-control.ts';

export type PilotStage='admission'|'source_upload'|'session_create'|'session_stream'|
  'artifact_list'|'artifact_download'|'proposal_validation'|'session_delete'|
  'session_cancel'|'source_delete'|'output_write';
export type PilotDiagnostic=Readonly<{
  version:1;stage:PilotStage;code:string;httpStatus?:number;requestId?:string;
  clientRequestId?:string;sessionId?:string;turnId?:string;providerCode?:string;
}>;
export type PilotReporter=(diagnostic:PilotDiagnostic)=>void;
export type PilotHttpContext=Pick<PilotDiagnostic,'httpStatus'|'requestId'|'clientRequestId'>;
export class PilotFailure extends Error {
  constructor(readonly diagnostic:PilotDiagnostic){super(diagnostic.code);}
}
export class PilotCleanupFailure extends Error {
  constructor(readonly primary:unknown,readonly cleanup:unknown){super('hosted-session-termination-unconfirmed');}
}
const codes=new Set([
  'hosted-create-failed','source-upload-provider-status','hosted-http-status',
  'network_or_timeout','request_started','request_succeeded','session_observed','root_completed',
  'controller_failure',
  'pilot-runtime-identity','pilot-input-invalid','pilot-source-run-drift','hosted-invalid-scope',
  'pilot-state-invalid','hosted-session-termination-unconfirmed',
  'hosted-frozen-issue','hosted-source-archive','hosted-launch-evidence','hosted-duplicate-run',
  'hosted-session-id','hosted-turn-id','hosted-stream-session-id','hosted-stream-root-id',
  'hosted-stream-json','hosted-stream-object','hosted-stream-event-size','hosted-stream-event-type',
  'hosted-stream-session-switch','hosted-stream-missing-session','hosted-stream-disconnected',
  'hosted-stream-total','hosted-stream-buffer','hosted-stream-incomplete','hosted-stream-turn',
  'hosted-root-failed','hosted-turn-not-completed','hosted-artifact-inventory',
  'hosted-artifact-identity','hosted-artifact-bytes','hosted-proposal-metadata',
  'hosted-delete-unconfirmed','hosted-http-shape','hosted-response-json',
  'hosted-artifacts-page','hosted-artifact-entry','hosted-artifacts-cursor',
  'hosted-artifacts-pagination-limit','hosted-too-many-artifacts','hosted-body-size',
  'hosted-body-content-length','hosted-empty-body','source-upload-provider-response',
  'source-upload-provider-data','source-upload-provider-identity','source-upload-integrity',
]);
const providerCodes=new Set(['invalid_request_error','invalid_api_key','insufficient_permissions',
  'permission_denied','insufficient_quota','rate_limit_exceeded','files_api_rate_limit_exceeded',
  'model_not_found','server_error','internal_error','environment_setup_failed','setup_failed']);
// IDs are opaque. Keep path components bounded without inventing sess_/turn_ prefixes.
export const PROVIDER_ID=/^[A-Za-z0-9_-]{1,256}$/;
function safeId(value:unknown):string|undefined {
  return typeof value==='string'&&PROVIDER_ID.test(value)&&
    !/(?:sk[-_]|github_pat|Bearer)/i.test(value)?value:undefined;
}
const stages=new Set<PilotStage>(['admission','source_upload','session_create','session_stream',
  'artifact_list','artifact_download','proposal_validation','session_delete','session_cancel','source_delete','output_write']);
/** Apply again at the logging boundary, including to typed errors. */
export function sanitizeDiagnostic(value:PilotDiagnostic):PilotDiagnostic {
  const result:{version:1;stage:PilotStage;code:string;httpStatus?:number;requestId?:string;
    clientRequestId?:string;sessionId?:string;turnId?:string;providerCode?:string}={version:1,
    stage:stages.has(value.stage)?value.stage:'admission',code:codes.has(value.code)?value.code:'controller_failure'};
  if(typeof value.httpStatus==='number'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)result.httpStatus=value.httpStatus;
  for(const field of ['requestId','clientRequestId','sessionId','turnId'] as const){
    const id=safeId(value[field]);if(id)result[field]=id;
  }
  if(value.providerCode!==undefined)result.providerCode=providerCodes.has(value.providerCode)?value.providerCode:'provider_error';
  return result;
}
export function diagnosticFor(error:unknown,stage:PilotStage):PilotDiagnostic {
  if(error instanceof PilotFailure)return sanitizeDiagnostic(error.diagnostic);
  const code=error instanceof ControlDenied&&codes.has(error.code)?error.code:'controller_failure';
  return {version:1,stage,code};
}
export function failureDiagnostics(error:unknown,stage:PilotStage):PilotDiagnostic[] {
  return error instanceof PilotCleanupFailure
    ? [...failureDiagnostics(error.primary,stage),...failureDiagnostics(error.cleanup,'session_delete')]
    : [diagnosticFor(error,stage)];
}
export function eventFailure(event:unknown,sessionId:string,http:PilotHttpContext={}):PilotFailure|undefined {
  if(!event||typeof event!=='object')return undefined;
  const e=event as Record<string,unknown>;
  const turn=e.turn&&typeof e.turn==='object'?e.turn as Record<string,unknown>:undefined;
  const terminal=['error','agent.session.failed','agent.session.environment.failed','agent.session.requires_action'].includes(String(e.type))||
    (['agent.session.turn.failed','agent.session.turn.cancelled'].includes(String(e.type))&&turn?.subagent_id===null);
  if(!terminal)return undefined;
  const source=(e.error??(e.environment as Record<string,unknown>|undefined)?.error??
    (e.session as Record<string,unknown>|undefined)?.error??turn?.error) as Record<string,unknown>|undefined;
  const providerCode=typeof source?.code==='string'&&providerCodes.has(source.code)?source.code:'provider_error';
  const turnId=safeId(turn?.id);
  return new PilotFailure({version:1,stage:'session_stream',code:'hosted-root-failed',providerCode,...http,
    ...(safeId(sessionId)?{sessionId}:{}),...(turnId?{turnId}:{})});
}
export type PilotFetcher=(url:string,init:RequestInit)=>Promise<Response>;
export async function boundedBody(response:Response,max:number):Promise<Uint8Array>{
  const length=response.headers.get('content-length');
  if(length!==null&&(!Number.isSafeInteger(Number(length))||Number(length)<0||Number(length)>max))
    throw new ControlDenied('hosted-body-content-length');
  if(!response.body)throw new ControlDenied('hosted-empty-body');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try {
    while(true){const next=await reader.read();if(next.done)break;
      total+=next.value.byteLength;if(total>max)throw new ControlDenied('hosted-body-size');chunks.push(next.value);}
    const result=new Uint8Array(total);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.byteLength;}return result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function pilotRequest(stage:PilotStage,url:string,init:RequestInit,
  fetcher:PilotFetcher,report:PilotReporter=()=>{},failureCode='hosted-http-status',
  accepted:readonly number[]=[200],timeoutMs=30_000):Promise<Response>{
  const clientRequestId=randomUUID();
  report({version:1,stage,code:'request_started',clientRequestId});
  let response:Response;
  try {response=await fetcher(url,{...init,signal:AbortSignal.timeout(timeoutMs),
    headers:{...init.headers,'X-Client-Request-Id':clientRequestId}});}
  catch {throw new PilotFailure({version:1,stage,code:'network_or_timeout',clientRequestId});}
  const requestId=safeId(response.headers.get('x-request-id'));
  const metadata={version:1 as const,stage,httpStatus:response.status,clientRequestId,...(requestId?{requestId}:{})};
  if(!accepted.includes(response.status)){
    let providerCode='provider_error';
    try {const payload=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await boundedBody(response,16*1024)));
      if(providerCodes.has(payload?.error?.code))providerCode=payload.error.code;
    }catch{/* Never log response text or parsing errors. */}
    throw new PilotFailure({...metadata,code:failureCode,providerCode});
  }
  report({...metadata,code:'request_succeeded'});return response;
}
