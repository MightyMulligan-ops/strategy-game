/** Durable metadata state machine for hosted agent sessions.
 * Trusted controller only. No API calls, keys, paid inference or automatic retries.
 * A separate authenticated admission collector and run ledger MUST authorize begin().
 */
import { ControlDenied, requireControl } from './codex-run-control.ts';

export type HostedPhase = 'reserved' | 'creating' | 'running' | 'completed' | 'failed' | 'ambiguous';
export type HostedJournal = Readonly<{
  version: 1; runId: string; scopeDigest: string; phase: HostedPhase;
  sessionId?: string; rootTurnId?: string;
}>;
export type HostedJournalSnapshot = {revision: string; value: HostedJournal | null};
export interface HostedJournalStore {
  read(runId: string): Promise<HostedJournalSnapshot>;
  compareAndSwap(runId: string, revision: string, value: HostedJournal): Promise<boolean>;
}
const runPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const sha256 = /^[a-f0-9]{64}$/;
const sessionPattern = /^sess_[A-Za-z0-9_-]{1,128}$/;
const turnPattern = /^turn_[A-Za-z0-9_-]{1,128}$/;
export function validateHostedJournal(j: HostedJournal): void {
  requireControl(j && j.version === 1 && runPattern.test(j.runId) && sha256.test(j.scopeDigest) &&
    ['reserved','creating','running','completed','failed','ambiguous'].includes(j.phase),
    'hosted-journal-shape');
  requireControl(j.sessionId === undefined || sessionPattern.test(j.sessionId), 'hosted-session-id');
  requireControl(j.rootTurnId === undefined || turnPattern.test(j.rootTurnId), 'hosted-turn-id');
  requireControl((j.phase === 'reserved' || j.phase === 'creating') ?
    j.sessionId === undefined && j.rootTurnId === undefined :
    (j.phase === 'running' || j.phase === 'completed') ?
      j.sessionId !== undefined :
      true, 'hosted-journal-phase');
  requireControl(j.rootTurnId === undefined || j.sessionId !== undefined, 'hosted-turn-without-session');
  requireControl(j.phase !== 'completed' || j.rootTurnId !== undefined, 'hosted-completion-without-turn');
}

/** The caller must durably reserve the whole run BEFORE begin(). This is not an admission service. */
export class HostedSessionJournal {
  constructor(private readonly store: HostedJournalStore) {}
  private async change(runId: string, fn: (current: HostedJournal | null) => HostedJournal): Promise<HostedJournal> {
    requireControl(runPattern.test(runId), 'hosted-run-id');
    for (let attempt = 0; attempt < 4; attempt++) {
      const {revision,value} = await this.store.read(runId);
      if (value) { validateHostedJournal(value); requireControl(value.runId === runId,'hosted-journal-identity'); }
      const next = fn(value);
      validateHostedJournal(next);
      if (await this.store.compareAndSwap(runId,revision,next)) return next;
    }
    throw new ControlDenied('hosted-journal-contention');
  }
  /** Caller MUST supply separately verified, durable run reservation. Never expose to worker. */
  async begin(runId: string,scopeDigest: string): Promise<HostedJournal> {
    requireControl(sha256.test(scopeDigest), 'hosted-scope-digest');
    return this.change(runId,previous=>{
      requireControl(previous === null, 'hosted-duplicate-run');
      return {version:1,runId,scopeDigest,phase:'reserved'};
    });
  }
  /** Must commit before making any network request that might create a billable session. */
  async markCreateStarted(runId: string): Promise<HostedJournal> {
    return this.change(runId,previous=>{
      requireControl(previous?.phase === 'reserved', 'hosted-create-already-started');
      return {...previous,phase:'creating'};
    });
  }
  /** Only an authenticated provider response or reconciled session record may supply ID. */
  async recordSession(runId: string,sessionId: string): Promise<HostedJournal> {
    requireControl(sessionPattern.test(sessionId), 'hosted-session-id');
    return this.change(runId,previous=>{
      requireControl(previous?.phase === 'creating', 'hosted-session-not-creating');
      return {...previous,phase:'running',sessionId};
    });
  }
  async recordRootCompletion(runId: string,sessionId: string,rootTurnId: string): Promise<HostedJournal> {
    requireControl(turnPattern.test(rootTurnId), 'hosted-turn-id');
    return this.change(runId,previous=>{
      requireControl(previous?.phase === 'running' && previous.sessionId === sessionId,
        'hosted-completion-not-running');
      return {...previous,phase:'completed',rootTurnId};
    });
  }
  /** Ambiguous creation or disconnect is irreversible until separate operator reconciliation. */
  async markUncertain(runId: string): Promise<HostedJournal> {
    return this.change(runId,previous=>{
      requireControl(previous && ['creating','running'].includes(previous.phase), 'hosted-uncertainty-state');
      return {...previous,phase:'ambiguous'};
    });
  }
  async markFailed(runId: string,sessionId: string): Promise<HostedJournal> {
    return this.change(runId,previous=>{
      requireControl(previous?.phase === 'running' && previous.sessionId === sessionId, 'hosted-failure-state');
      return {...previous,phase:'failed'};
    });
  }
}
