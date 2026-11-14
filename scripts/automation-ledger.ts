// Stage 2 authenticated ledger core. No agent launch, GitHub permissions or deployment.
// Storage adapter MUST provide serializable, durable compare-and-append transactions.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type LedgerKind = "task-claimed" | "task-transfer" | "task-closed" |
  "owner-grant" | "owner-revocation" | "implementation-attempt-started" |
  "implementation-attempt-outcome" | "repair-attempt-started" |
  "repair-attempt-outcome" | "evidence-checkpoint";
export type LedgerBody = {
  version: 1; repository: string; issue: number; taskId: string;
  eventId: string; kind: LedgerKind; failureId: string | null;
  attempt: number | null; sourceHead: string; baseHead: string;
  actorId: string; approvalSource: string; timestamp: string;
};
export type SignedLedgerEvent = LedgerBody & {
  sequence: number; previousDigest: string | null; digest: string; mac: string;
};
export type LedgerState = { implementationUsed: number; repairUsed: Record<string, number>; revoked: boolean; closed: boolean };
export type LedgerResult = { ok: true; state: LedgerState; head: string } |
  { ok: false; reason: string };
export interface DurableLedgerStore {
  // Must serialize concurrent writers, reject stale expected heads and commit atomically.
  read(taskKey: string): Promise<readonly SignedLedgerEvent[]>;
  compareAndAppend(taskKey: string, expectedHead: string | null, event: SignedLedgerEvent): Promise<boolean>;
}
const digestRe = /^sha256:[a-f0-9]{64}$/;
const shaRe = /^[a-f0-9]{40}$/;
const taskRe = /^[a-z0-9][a-z0-9-]{0,79}$/;
const failureRe = /^[A-Z][A-Z0-9_-]{0,79}$/;
const idRe = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const kinds: readonly LedgerKind[] = ["task-claimed","task-transfer","task-closed","owner-grant","owner-revocation",
  "implementation-attempt-started","implementation-attempt-outcome","repair-attempt-started","repair-attempt-outcome","evidence-checkpoint"];
function payload(e: Omit<SignedLedgerEvent,"digest"|"mac">): string {
  // Fixed field order prevents attacker-controlled JSON key order from changing semantics.
  return JSON.stringify([e.version,e.repository,e.issue,e.taskId,e.eventId,e.kind,e.failureId,e.attempt,
    e.sourceHead,e.baseHead,e.actorId,e.approvalSource,e.timestamp,e.sequence,e.previousDigest]);
}
export function signLedgerEvent(e: Omit<SignedLedgerEvent,"digest"|"mac">, secret: Uint8Array): SignedLedgerEvent {
  if (secret.byteLength < 32) throw Error("ledger signing key must have >=32 bytes");
  const digest = "sha256:" + createHash("sha256").update(payload(e)).digest("hex");
  const mac = createHmac("sha256",secret).update(digest).digest("hex");
  return {...e,digest,mac};
}
export function verifyLedger(events: readonly SignedLedgerEvent[] | null | undefined,
  identity: Pick<LedgerBody,"repository"|"issue"|"taskId">, secret: Uint8Array,
  checkpoint: { sequence: number; digest: string } | null): LedgerResult {
  const fail = (reason: string): LedgerResult => ({ok:false,reason});
  if (!events || !Array.isArray(events) || !events.length || events.length > 1000 ||
      !checkpoint || !Number.isSafeInteger(checkpoint.sequence) || !digestRe.test(checkpoint.digest) ||
      secret.byteLength < 32) return fail("MISSING_TRUSTED_HISTORY_OR_CHECKPOINT");
  if (checkpoint.sequence !== events.length || checkpoint.digest !== events[events.length-1]?.digest)
    return fail("CHECKPOINT_MISMATCH");
  const ids = new Set<string>(), starts = new Set<string>(), outcomes = new Set<string>();
  const repairs: Record<string,number> = Object.create(null) as Record<string,number>;
  let used = 0, previous: string | null = null, revoked = false, closed = false;
  for (let i=0;i<events.length;i++) {
    const e = events[i]!;
    if (e.version !== 1 || e.repository !== identity.repository || e.issue !== identity.issue ||
      e.taskId !== identity.taskId || !taskRe.test(e.taskId) || !idRe.test(e.eventId) ||
      ids.has(e.eventId) || !kinds.includes(e.kind) ||
      !shaRe.test(e.sourceHead) || !shaRe.test(e.baseHead) ||
      !idRe.test(e.actorId) || !e.approvalSource || e.approvalSource.length > 256 ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(e.timestamp) ||
      e.sequence !== i+1 || e.previousDigest !== previous || !digestRe.test(e.digest) ||
      !/^[a-f0-9]{64}$/.test(e.mac)) return fail("INVALID_EVENT_OR_CHAIN");
    const expected = signLedgerEvent({
      version:e.version,repository:e.repository,issue:e.issue,taskId:e.taskId,eventId:e.eventId,
      kind:e.kind,failureId:e.failureId,attempt:e.attempt,sourceHead:e.sourceHead,
      baseHead:e.baseHead,actorId:e.actorId,approvalSource:e.approvalSource,
      timestamp:e.timestamp,sequence:e.sequence,previousDigest:e.previousDigest
    },secret);
    if (e.digest !== expected.digest ||
      !timingSafeEqual(Buffer.from(e.mac,"hex"),Buffer.from(expected.mac,"hex")))
      return fail("SIGNATURE_OR_PAYLOAD_MISMATCH");
    ids.add(e.eventId);previous=e.digest;
    const impl=e.kind.startsWith("implementation-attempt-"), repair=e.kind.startsWith("repair-attempt-");
    if (impl || repair) {
      if (!Number.isSafeInteger(e.attempt) || e.attempt! < 1 ||
        (impl ? e.failureId !== null : !e.failureId || !failureRe.test(e.failureId)))
        return fail("INVALID_ATTEMPT");
      const key=impl ? `implementation:${e.attempt}` : `repair:${e.failureId}:${e.attempt}`;
      if (e.kind.endsWith("-started")) {
        if (revoked || closed || starts.has(key)) return fail("DUPLICATE_OR_REVOKED_START");
        if (impl) {if (e.attempt !== used+1 || e.attempt!>5) return fail("IMPLEMENTATION_LIMIT");used=e.attempt!;}
        else {if (e.attempt !== (repairs[e.failureId!]??0)+1 || e.attempt!>2) return fail("REPAIR_LIMIT");repairs[e.failureId!]=e.attempt!;}
        starts.add(key);
      } else {if (!starts.has(key) || outcomes.has(key)) return fail("ORPHAN_OR_DUPLICATE_OUTCOME");outcomes.add(key);}
    } else if (e.attempt !== null || e.failureId !== null) return fail("INVALID_NON_ATTEMPT");
    if (e.kind==="owner-revocation") revoked=true;
    if (e.kind==="task-closed") closed=true;
  }
  if (revoked || closed) return fail("TASK_REVOKED_OR_CLOSED");
  return {ok:true,state:{implementationUsed:used,repairUsed:{...repairs},revoked,closed},head:previous!};
}
export async function appendLedgerEvent(store: DurableLedgerStore, taskKey: string,
  identity: Pick<LedgerBody,"repository"|"issue"|"taskId">, body: LedgerBody,
  secret: Uint8Array, checkpoint: {sequence:number;digest:string}|null): Promise<LedgerResult> {
  // The checkpoint MUST come from an independently trusted signer/store, never the caller.
  const history=await store.read(taskKey);
  if (history.length===0) return {ok:false,reason:"GENESIS_REQUIRES_TRUSTED_PROVISIONING"};
  const verified=verifyLedger(history,identity,secret,checkpoint);
  if (!verified.ok) return verified;
  if (body.repository!==identity.repository || body.issue!==identity.issue || body.taskId!==identity.taskId)
    return {ok:false,reason:"IDENTITY_MISMATCH"};
  const next=signLedgerEvent({...body,sequence:history.length+1,previousDigest:verified.head},secret);
  const candidate=verifyLedger([...history,next],identity,secret,
    {sequence:history.length+1,digest:next.digest});
  if (!candidate.ok) return candidate;
  // Fail closed on race; never automatically retry a consumed attempt.
  if (!await store.compareAndAppend(taskKey,verified.head,next)) return {ok:false,reason:"CONCURRENT_WRITE"};
  return candidate;
}
