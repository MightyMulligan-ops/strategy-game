/** Trusted controller HTTP transport for immutable Agents artifacts and session cleanup.
 * No session creation, billing, source upload, owner approval, or paid inference here.
 * Execute ONLY in the secret-bearing controller, never next to untrusted code.
 */
import {ControlDenied,requireControl} from './codex-run-control.ts';
import type {HostedArtifact} from './codex-hosted-agents.ts';
import {boundedBody,pilotRequest,diagnosticFor,PilotFailure,PROVIDER_ID,type PilotReporter,type PilotStage} from './codex-pilot-diagnostics.ts';

const API = 'https://api.openai.com/v1/agents/sessions';
const ID = PROVIDER_ID;
type Fetcher = (url:string,init:RequestInit)=>Promise<Response>;
const obj=(v:unknown):Record<string,unknown>=>{
  requireControl(v!==null && typeof v==='object' && !Array.isArray(v),'hosted-http-shape');
  return v as Record<string,unknown>;
};
export type ArtifactListing = {items:HostedArtifact[];allPagesRead:boolean};

/** The caller supplies a project-scoped credential ONLY in the controller process. */
export class OpenAIHostedArtifacts {
  constructor(private readonly key:string,private readonly fetcher:Fetcher=fetch,
    private readonly report:PilotReporter=()=>{},
    private readonly pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
    requireControl(typeof key==='string' && key.length>0,'hosted-credential-missing');
  }
  private async request(method:'GET'|'DELETE',path:string,stage:PilotStage,
    accepted:readonly number[]=[200]):Promise<Response>{
    requireControl(path.startsWith('/') && !path.includes('..') &&
      !/[?#]/.test(path.split('?')[0]!) && path.length<500,'hosted-url');
    const response=await pilotRequest(stage,API+path,{
      method,redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+this.key,'OpenAI-Beta':'agents=v1',
        Accept:method==='DELETE'?'application/json':'*/*'},
    },this.fetcher,this.report,'hosted-http-status',accepted,10_000);
    return response;
  }
  private async json(response:Response,max=64*1024):Promise<Record<string,unknown>> {
    const bytes=await boundedBody(response,max);
    let data:unknown;
    try {data=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}
    catch {throw new ControlDenied('hosted-response-json');}
    return obj(data);
  }
  async listArtifacts(sessionId:string):Promise<ArtifactListing>{
    try {
    requireControl(ID.test(sessionId),'hosted-session-id');
    const items:HostedArtifact[]=[];
    const seen=new Set<string>();
    let cursor:string|undefined;
    for(let page=0;page<4;page++){
      const url='/'+sessionId+'/artifacts?limit=100&order=asc'+
        (cursor?'&after='+encodeURIComponent(cursor):'');
      const data=await this.json(await this.request('GET',url,'artifact_list'));
      requireControl(data.object==='list' && Array.isArray(data.data) &&
        data.data.length<=100 && typeof data.has_more==='boolean','hosted-artifacts-page');
      for (const raw of data.data) {
        const entry=obj(raw);
        requireControl(typeof entry.id==='string' && ID.test(entry.id) &&
          typeof entry.turn_id==='string' && ID.test(entry.turn_id) &&
          typeof entry.path==='string' && entry.path.startsWith('/workspace/outputs/') &&
          entry.session_id===sessionId && !seen.has(entry.id),'hosted-artifact-entry');
        requireControl(items.length<64,'hosted-too-many-artifacts');
        seen.add(entry.id);
        items.push({id:entry.id,path:entry.path,turn_id:entry.turn_id});
      }
      if(data.has_more===false) return {items,allPagesRead:true};
      requireControl(typeof data.last_id==='string' && ID.test(data.last_id) &&
        data.last_id!==cursor && data.data.length>0,'hosted-artifacts-cursor');
      cursor=data.last_id;
    }
    throw new ControlDenied('hosted-artifacts-pagination-limit');
    }catch(error){throw new PilotFailure(diagnosticFor(error,'artifact_list'));}
  }
  /** Byte limits are checked DURING streamed delivery, never after reading an unbounded body. */
  async downloadBounded(sessionId:string,artifactId:string,maxBytes:number):Promise<Uint8Array>{
    try {
    requireControl(ID.test(sessionId) && ID.test(artifactId) && Number.isSafeInteger(maxBytes) &&
      maxBytes>0 && maxBytes<=1_500_000,'hosted-download-input');
    const response=await this.request('GET','/'+sessionId+'/artifacts/'+artifactId+'/content','artifact_download');
    return await boundedBody(response,maxBytes);
    }catch(error){throw new PilotFailure(diagnosticFor(error,'artifact_download'));}
  }
  /** Only cleanup retries: cancel current work on 409, then bounded delete attempts.
   * Never creates a session, resubmits a task, or retries an ambiguous paid call. */
  async deleteSession(sessionId:string):Promise<void>{
    requireControl(ID.test(sessionId),'hosted-session-id');
    for(let attempt=0;attempt<3;attempt++){
      const response=await this.request('DELETE','/'+sessionId,'session_delete',[200,409]);
      if(response.status===200){
        const reply=await this.json(response);
        requireControl(reply.deleted===true && reply.id===sessionId &&
          reply.object==='agent.session.deleted','hosted-delete-unconfirmed');return;
      }
      await response.body?.cancel();
      if(attempt===0){
        const cancelled=await pilotRequest('session_cancel',API+'/'+sessionId+'/events',{
          method:'POST',redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+this.key,
            'OpenAI-Beta':'agents=v1','Content-Type':'application/json'},
          body:JSON.stringify({events:[{type:'agent.session.input.cancel'}]}),
        },this.fetcher,this.report,'hosted-http-status',[200,201],10_000);
        await cancelled.body?.cancel();
      }
      if(attempt<2)await this.pause(1000);
    }
    throw new ControlDenied('hosted-delete-unconfirmed');
  }
}
