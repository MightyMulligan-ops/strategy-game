/** Actual provider adapter. Tests inject synthetic HTTP; no calls at import time.
 * Unknown creation/termination NEVER authorizes another session. */
import {OpenAIHostedStreamingProvider} from './codex-hosted-stream.ts';
import {OpenAIHostedArtifacts} from './codex-openai-artifacts.ts';
import {boundedBody,PROVIDER_ID,type PilotFetcher} from './codex-pilot-diagnostics.ts';
import type {HostedProvider,HostedPacket} from './codex-hosted-orchestrator.ts';
import {HOSTED_MODEL} from './codex-hosted-agents.ts';
import type {HostedSessionRequest} from './codex-hosted-agents.ts';
import {SOFT_LIMIT_MICRO_USD,observeSessionCost,type CostObservation} from './overnight-cost.ts';
import {MANUAL_WATCHDOG_SECONDS} from './overnight-policy.ts';
import {ControlDenied,requireControl} from './codex-run-control.ts';
export type ProviderState={version:1;model:typeof HOSTED_MODEL;createAttempted:boolean;sessionId:string|null;coding:'not_started'|'creating'|'active'|'completed'|'failed'|'unknown';
  termination:'not_started'|'unknown'|'deleted_confirmed';usage:CostObservation|null;stopReason?:'soft-limit'|'usage-unavailable'|'watchdog'};
export const initialProviderState=():ProviderState=>({version:1,model:HOSTED_MODEL,createAttempted:false,sessionId:null,coding:'not_started',termination:'not_started',usage:null});
export class QueueSessionProvider implements HostedProvider {
  readonly state=initialProviderState();
  private readonly stream:OpenAIHostedStreamingProvider;
  private readonly cleanup:OpenAIHostedArtifacts;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private identityTimer:ReturnType<typeof setTimeout>|undefined;
  private readonly abort=new AbortController();
  constructor(private readonly key:string,private readonly seconds:number,private readonly beforeCreate:()=>Promise<void>,
    private readonly save:(state:ProviderState)=>void,private readonly fetcher:PilotFetcher=fetch,private readonly deadlineAt=Infinity,private readonly costGuard=false){
    requireControl(Number.isFinite(seconds)&&seconds>0&&seconds<=(costGuard?MANUAL_WATCHDOG_SECONDS:900),'queue-provider-budget');
    const bounded: PilotFetcher=(url,init)=>fetcher(url,{...init,signal:AbortSignal.any([this.abort.signal,...(init.signal?[init.signal]:[])])});
    this.stream=new OpenAIHostedStreamingProvider(key,bounded,()=>{},seconds*1000);
    // Cleanup gets its own bounded HTTP timeout, never an already aborted signal.
    this.cleanup=new OpenAIHostedArtifacts(key,fetcher);
  }
  private monitorTimer:ReturnType<typeof setTimeout>|undefined;
  private monitorWork:Promise<void>|undefined;
  private monitoring=false;
  private startMonitor(id:string,key:string,fetcher:PilotFetcher,started:number){
    this.monitoring=true;
    const poll=()=>{
      this.monitorWork=(async()=>{
        try{
          const observation=await observeSessionCost(key,id,Date.now()-started,fetcher);
          if(!this.monitoring)return;
          this.state.usage={...observation,estimatedMicroUsd:Math.max(observation.estimatedMicroUsd,this.state.usage?.estimatedMicroUsd??0)};this.write();
          if(this.state.usage.estimatedMicroUsd>=SOFT_LIMIT_MICRO_USD){this.state.stopReason='soft-limit';this.abort.abort();this.write();return}
        }catch(error){if(this.monitoring&&(!(error instanceof ControlDenied&&error.code==='queue-usage-unavailable')||Date.now()-started>120000)){this.state.stopReason='usage-unavailable';this.abort.abort();this.write();return}}
        if(this.monitoring)this.monitorTimer=setTimeout(poll,15000);
      })();
    };poll();
  }
  private write(){this.save(structuredClone(this.state))}
  async *createSession(request:HostedSessionRequest):AsyncGenerator<HostedPacket>{
    requireControl(!this.state.createAttempted,'queue-provider-repeat');
    await this.beforeCreate();
    const milliseconds=Math.min(this.seconds*1000,this.deadlineAt-Date.now());requireControl(milliseconds>0,'queue-provider-window-expired');
    this.state.createAttempted=true;this.state.coding='creating';this.state.termination='unknown';this.write();
    this.timer=setTimeout(()=>{this.state.stopReason='watchdog';this.write();this.abort.abort()},milliseconds);
    const started=Date.now();
    if(this.costGuard)this.identityTimer=setTimeout(()=>{this.state.stopReason='usage-unavailable';this.abort.abort();this.write()},120000);
    try{
      for await(const p of this.stream.createSession(request)){
        requireControl(PROVIDER_ID.test(p.sessionId)&&(!this.state.sessionId||this.state.sessionId===p.sessionId),'queue-provider-identity');
        const first=this.state.sessionId===null;this.state.sessionId=p.sessionId;
        if(first&&this.costGuard){clearTimeout(this.identityTimer);this.startMonitor(p.sessionId,this.key,this.fetcher,started)}
        if(p.event.type==='agent.session.turn.completed'&&p.event.turn?.subagent_id===null)this.state.coding='completed';
        else if(['agent.session.failed','agent.session.environment.failed','agent.session.turn.failed','agent.session.turn.cancelled'].includes(p.event.type))this.state.coding='failed';
        else this.state.coding='active';
        if(this.state.coding==='completed'&&this.costGuard){
          await this.monitorWork;
          try{
            const final=await observeSessionCost(this.key,p.sessionId,Date.now()-started,this.fetcher);
            this.state.usage={...final,estimatedMicroUsd:Math.max(final.estimatedMicroUsd,this.state.usage?.estimatedMicroUsd??0)};
            if(this.state.usage.estimatedMicroUsd>=SOFT_LIMIT_MICRO_USD){this.state.stopReason='soft-limit';this.abort.abort()}
          }catch{this.state.stopReason='usage-unavailable';this.abort.abort()}
        }
        this.write();requireControl(!this.abort.signal.aborted,'queue-provider-stopped');yield p;
      }
    }catch(error){if(this.state.coding!=='completed'&&this.state.coding!=='failed')this.state.coding='unknown';this.write();throw error}
    finally{
      clearTimeout(this.timer);clearTimeout(this.identityTimer);this.monitoring=false;clearTimeout(this.monitorTimer);
      try{await this.monitorWork}catch{this.abort.abort()}
      // Even a timeout before the first SSE packet may have created a session.
      // No ID means cleanup cannot identify it; preserve unknown state/claim.
      if(this.abort.signal.aborted&&this.state.sessionId){
        try{await this.deleteSession(this.state.sessionId)}catch{/* state remains unknown; no retry of creation */}
      }
    }
  }
  listArtifacts(id:string){return this.stream.listArtifacts(id)}
  downloadBounded(id:string,artifact:string,max:number){return this.stream.downloadBounded(id,artifact,max)}
  async deleteSession(id:string){
    requireControl(id===this.state.sessionId,'queue-cleanup-identity');
    if(this.state.termination==='deleted_confirmed')return;
    try{await this.cleanup.deleteSession(id);this.state.termination='deleted_confirmed';this.write()}
    catch(error){this.state.termination='unknown';this.write();throw error}
  }
}
/** Operator-only observation; GET is not authoritative termination. Only a
 * matching explicit DELETE acknowledgement can establish this adapter's proof.
 * 404, malformed status and lost responses remain unknown. Never POST a session. */
export async function reconcileProvider(key:string,id:string,terminate:boolean,fetcher:PilotFetcher=fetch){
  requireControl(PROVIDER_ID.test(id),'queue-reconcile-id');
  if(terminate){await new OpenAIHostedArtifacts(key,fetcher).deleteSession(id);return {sessionId:id,state:'deleted_confirmed' as const}}
  const r=await fetcher('https://api.openai.com/v1/agents/sessions/'+id,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+key,'OpenAI-Beta':'agents=v1'}});
  if(r.status!==200)return {sessionId:id,state:'unknown' as const};
  const v=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await boundedBody(r,65536))) as Record<string,unknown>;
  requireControl(v.id===id,'queue-reconcile-provider-identity');
  // Provider schema evolves; unknown enum values do not mean inactive.
  const state=typeof v.status==='string'&&['in_progress','completed','failed','cancelled'].includes(v.status)?v.status:'unknown';
  return {sessionId:id,state};
}
