/** Offline-testable orchestration seam for hosted Agents sessions.
 * No HTTP transport, API key, independent validator or publisher is installed.
 * Provider adapters MUST authenticate IDs/events, bound downloads before allocation,
 * and prove whole-session billing/cancellation exposure before any live use.
 */
import {buildHostedSessionRequest, HOSTED_ARTIFACTS, initialHostedTurn,
  observeHostedEvent, requireCompletedHostedTurn, verifyHostedArtifactBytes,
  verifyHostedArtifactInventory, type HostedAdmission, type HostedArtifact,
  type HostedEvent, type HostedSessionRequest} from './codex-hosted-agents.ts';
import {validateProposal} from './codex-automation-policy.ts';
import {HostedSessionJournal} from './codex-hosted-journal.ts';
import {ControlDenied,requireControl} from './codex-run-control.ts';

export type HostedPacket = {sessionId: string; event: HostedEvent; rootTurnId?: string};
export interface HostedProvider {
  /** This is a BILLABLE call. It must be executed only after durable reservations. */
  createSession(request: HostedSessionRequest): AsyncIterable<HostedPacket>;
  listArtifacts(sessionId: string): Promise<{items: HostedArtifact[]; allPagesRead: boolean}>;
  /** Must enforce the byte cap while streaming, not after an unbounded download. */
  downloadBounded(sessionId: string,artifactId: string,maxBytes: number): Promise<Uint8Array>;
  /** Must confirm server-side termination; stream.abort alone is not cancellation. */
  deleteSession(sessionId: string): Promise<void>;
}
export type UntrustedHostedProposal = {
  sessionId: string; rootTurnId: string;
  patch: Uint8Array; manifest: string; summary: string;
};

export class HostedAgentOrchestrator {
  constructor(private readonly journal: HostedSessionJournal,private readonly provider: HostedProvider) {}
  async run(runId: string,admission: HostedAdmission): Promise<UntrustedHostedProposal> {
    // This call is NOT the authorization source. Caller must independently authenticate
    // all evidence and reserve full run cost in RunController BEFORE entering this method.
    const request=buildHostedSessionRequest(admission);
    await this.journal.begin(runId,admission.scopeDigest);
    await this.journal.markCreateStarted(runId); // irrevocable before paid call
    let sessionId: string|undefined;
    let rootTurnId: string|undefined;
    let turn=initialHostedTurn;
    let markedTerminal=false;
    try {
      for await (const packet of this.provider.createSession(request)) {
        requireControl(packet && typeof packet.sessionId === 'string', 'hosted-provider-packet');
        if (!sessionId) {
          await this.journal.recordSession(runId,packet.sessionId);
          sessionId=packet.sessionId;
        } else requireControl(sessionId===packet.sessionId,'hosted-session-switch');
        turn=observeHostedEvent(turn,packet.event);
        if (turn.failed) {
          await this.journal.markFailed(runId,sessionId);
          markedTerminal=true;
          throw new ControlDenied('hosted-root-failed');
        }
        if (turn.completed) {
          requireControl(typeof packet.rootTurnId === 'string', 'hosted-root-turn-id');
          rootTurnId=packet.rootTurnId;
          await this.journal.recordRootCompletion(runId,sessionId,rootTurnId);
          markedTerminal=true;
          break;
        }
      }
      requireCompletedHostedTurn(turn);
      requireControl(sessionId && rootTurnId, 'hosted-completed-identity');
      const listing=await this.provider.listArtifacts(sessionId);
      const ids=verifyHostedArtifactInventory(listing.items,rootTurnId,listing.allPagesRead);
      const caps=[1_500_000,32*1024,16*1024] as const;
      const bytes: Uint8Array[]=[];
      for (let i=0;i<HOSTED_ARTIFACTS.length;i++) {
        const path=HOSTED_ARTIFACTS[i]!;
        const data=await this.provider.downloadBounded(sessionId,ids[path],caps[i]!);
        verifyHostedArtifactBytes(path,data);
        bytes.push(data);
      }
      const decoder=new TextDecoder('utf8',{fatal:true});
      const manifest=decoder.decode(bytes[1]!);
      const summary=decoder.decode(bytes[2]!);
      const patch=bytes[0]!;
      const errors=validateProposal(admission.scope,manifest,patch,summary);
      requireControl(errors.length===0,'hosted-proposal-metadata');
      // This is NOT a complete patch replay, code test or signed validation receipt.
      return {sessionId,rootTurnId,patch,manifest,summary};
    } catch (error) {
      if (!markedTerminal) {
        try {await this.journal.markUncertain(runId);} catch { /* fail closed; never retry create */ }
      }
      throw error;
    } finally {
      if (sessionId) {
        // An unconfirmed delete blocks delivery, because stream close != task cancellation.
        try {await this.provider.deleteSession(sessionId);}
        catch {throw new ControlDenied('hosted-session-termination-unconfirmed');}
      }
    }
  }
}
