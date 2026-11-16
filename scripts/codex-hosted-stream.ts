/** Fixed-origin Agents API streaming transport. A real call is billable.
 * This is a library, NOT a workflow entrypoint or an owner-grant/billing controller.
 * Must be called only after separate authorization; NEVER from an untrusted agent.
 */
import { ControlDenied, requireControl } from './codex-run-control.ts';
import { OpenAIHostedArtifacts } from './codex-openai-artifacts.ts';
import type { HostedProvider, HostedPacket } from './codex-hosted-orchestrator.ts';
import type { HostedSessionRequest } from './codex-hosted-agents.ts';
import {pilotRequest,diagnosticFor,PilotFailure,PROVIDER_ID,type PilotReporter,type PilotHttpContext} from './codex-pilot-diagnostics.ts';

const ENDPOINT = 'https://api.openai.com/v1/agents/sessions';
const SESSION_ID = PROVIDER_ID;
const TURN_ID = PROVIDER_ID;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const asObj = (value: unknown): Record<string,unknown> => {
  requireControl(value !== null && typeof value === 'object' && !Array.isArray(value),'hosted-stream-object');
  return value as Record<string,unknown>;
};
export type AgentStreamEvent = Readonly<{
  type: string;
  session?: {id?: string};
  session_id?: string;
  turn?: {id?: string; subagent_id?: string|null};
}>;
function sessionIdFor(event: AgentStreamEvent): string|undefined {
  const value=event.session_id ?? event.session?.id;
  if(value === undefined) return undefined;
  requireControl(typeof value === 'string' && SESSION_ID.test(value),'hosted-stream-session-id');
  return value;
}
function eventFrom(raw: string): AgentStreamEvent {
  requireControl(Buffer.byteLength(raw,'utf8') <= 1024*1024,'hosted-stream-event-size');
  let parsed: unknown;
  try {parsed=JSON.parse(raw);} catch {throw new ControlDenied('hosted-stream-json');}
  const data=asObj(parsed);
  requireControl(typeof data.type === 'string' && data.type.length < 150,'hosted-stream-event-type');
  const event=data as AgentStreamEvent;
  if(event.turn !== undefined) {
    const turn=asObj(event.turn);
    requireControl(turn.subagent_id === null || turn.subagent_id === undefined ||
      typeof turn.subagent_id === 'string','hosted-stream-turn');
  }
  return event;
}
/** Parse UTF-8 SSE incrementally; emit ONLY parsed event JSON, never untrusted raw logs. */
export async function* parseAgentSse(
  body: ReadableStream<Uint8Array>, maxBytes=8*1024*1024,
):AsyncGenerator<AgentStreamEvent> {
  requireControl(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=8*1024*1024,'hosted-stream-limit');
  const reader=body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',total=0,eventData:string[]=[];
  const extract=(block:string):AgentStreamEvent|undefined=>{
    const lines=block.split(/\r?\n/);
    for(const line of lines) {
      if(line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
    }
    if(eventData.length===0) return undefined;
    const data=eventData.join('\n');eventData=[];
    if(data==='[DONE]')return undefined;
    return eventFrom(data);
  };
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      requireControl(total<=maxBytes,'hosted-stream-total');
      // Match CRLF or LF record terminators across arbitrary network chunks.
      buffer+=decoder.decode(value,{stream:true});
      let boundary:RegExpExecArray|null;
      while((boundary=/\r?\n\r?\n/.exec(buffer))!==null) {
        const block=buffer.slice(0,boundary.index);
        buffer=buffer.slice(boundary.index+boundary[0].length);
        const ev=extract(block);
        if(ev)yield ev;
      }
      // Check the unfinished record, not a coalesced chunk of many valid records.
      requireControl(Buffer.byteLength(buffer,'utf8')<=1024*1024,'hosted-stream-buffer');
    }
    buffer+=decoder.decode();
    requireControl(buffer.trim()==='' && eventData.length===0,'hosted-stream-incomplete');
  } finally {
    await reader.cancel().catch(()=>{ /* stream may already be closed */ });
    reader.releaseLock();
  }
}

/** No retries. The caller must durably claim the run before createSession is invoked. */
export class OpenAIHostedStreamingProvider implements HostedProvider {
  private readonly artifacts:OpenAIHostedArtifacts;
  constructor(private readonly key:string, private readonly fetcher:Fetcher=fetch,
    private readonly report:PilotReporter=()=>{}) {
    requireControl(typeof key==='string'&&key.length>0,'hosted-credential-missing');
    this.artifacts=new OpenAIHostedArtifacts(key,fetcher,report);
  }
  async *createSession(request:HostedSessionRequest):AsyncGenerator<HostedPacket> {
    requireControl(request.environment.type==='openai_hosted'&&
      request.environment.network.access==='disabled'&&request.stream===true,
      'hosted-stream-policy');
    let http:PilotHttpContext={};
    const response=await pilotRequest('session_create',ENDPOINT,{
      method:'POST',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+this.key,'OpenAI-Beta':'agents=v1',
        'Content-Type':'application/json',Accept:'text/event-stream'},
      body:JSON.stringify(request),
    },this.fetcher,d=>{
      if(d.code==='request_succeeded')http={httpStatus:d.httpStatus!,
        ...(d.requestId?{requestId:d.requestId}:{}),...(d.clientRequestId?{clientRequestId:d.clientRequestId}:{})};
      this.report(d);
    },'hosted-create-failed',[200,201],13*60_000);
    requireControl(response.body !== null,'hosted-create-failed');
    let knownSession:string|undefined;
    let rootDone=false;
    try {for await(const event of parseAgentSse(response.body!)) {
      const found=sessionIdFor(event);
      if(found!==undefined) {
        requireControl(!knownSession||knownSession===found,'hosted-stream-session-switch');
        knownSession=found;
      }
      // A missing session ID is ambiguous: do not invent or infer one from an artifact.
      requireControl(knownSession!==undefined,'hosted-stream-missing-session');
      let rootTurnId:string|undefined;
      if(event.type==='agent.session.turn.completed'&&event.turn?.subagent_id===null) {
        requireControl(typeof event.turn.id==='string'&&TURN_ID.test(event.turn.id),'hosted-stream-root-id');
        rootTurnId=event.turn.id;
        rootDone=true;
      }
      yield {sessionId:knownSession,event,http, ...(rootTurnId?{rootTurnId}:{})};
      if(rootDone) return;
    }
    throw new ControlDenied('hosted-stream-disconnected');
    }catch(error){throw new PilotFailure({...diagnosticFor(error,'session_stream'),
      ...http,...(knownSession?{sessionId:knownSession}:{} )});}
  }
  listArtifacts(sessionId:string) {return this.artifacts.listArtifacts(sessionId);}
  downloadBounded(sessionId:string,artifactId:string,maxBytes:number) {
    return this.artifacts.downloadBounded(sessionId,artifactId,maxBytes);
  }
  deleteSession(sessionId:string) {return this.artifacts.deleteSession(sessionId);}
}
