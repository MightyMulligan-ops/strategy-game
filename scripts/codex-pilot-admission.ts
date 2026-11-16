/** Simplified *pilot* admission: no local USD cutoff.
 * The owner's OpenAI Platform limits govern spending (not an instantaneous hard stop).
 * Does NOT create a session, prove a GitHub permission, or authenticate its own evidence.
 * Trusted GitHub controller MUST supply the observations; never accept them from a worker.
 */
import {canonicalScope,sha256,type TaskScope,OWNER,REPOSITORY} from './codex-automation-policy.ts';
import {ControlDenied,requireControl} from './codex-run-control.ts';

export const PILOT_MAX_WALL_SECONDS = 900;
export const PILOT_MAX_ACTIVE_JOBS = 1;
export type PilotAdmissionEvidence = Readonly<{
  actor: string; actorId: number; repository: string;
  event: string; ref: string; runAttempt: number; issue: number;
  sourceSha: string; baseSha: string; now: string;
  signedOwnerGrantVerified: boolean; grantRevoked: boolean;
  frozenScopeDigest: string; exclusiveRunClaimVerified: boolean;
  verifiedProjectKeyIsolation: boolean; hostedNetworkDisabled: boolean;
  sessionTerminationAvailable: boolean; activeJobs: number;
  requestedWallSeconds: number;
}>;
/** The output is a pure authorization decision, NOT a launcher credential. */
export function assessPilotAdmission(scope:TaskScope,e:PilotAdmissionEvidence):
  Readonly<{approved:boolean;reasons:readonly string[];scopeDigest:string|null}> {
  const reasons:string[]=[];
  let digest:string|null=null;
  try{digest=sha256(canonicalScope(scope));}catch{reasons.push('invalid-scope');}
  if(e.actor!==OWNER || e.actorId!==353505747 ||
     e.repository!==REPOSITORY || e.ref!=='refs/heads/main' ||
     e.event!=='workflow_dispatch' || e.runAttempt!==1)reasons.push('untrusted-trigger');
  if(e.issue!==scope.issue || e.sourceSha!==scope.sourceSha ||
     e.baseSha!==scope.baseSha || e.issue!==76)reasons.push('scope-drift');
  if(!e.signedOwnerGrantVerified || e.grantRevoked!==false ||
     digest===null || digest!==e.frozenScopeDigest)reasons.push('owner-grant');
  const now=Date.parse(e.now);
  if(!Number.isFinite(now)||!Number.isFinite(Date.parse(scope.expiresAt))||
     now>=Date.parse(scope.expiresAt))reasons.push('expired');
  if(e.exclusiveRunClaimVerified!==true || !Number.isInteger(e.activeJobs) ||
     e.activeJobs!==0)reasons.push('active-run');
  if(!e.verifiedProjectKeyIsolation || !e.hostedNetworkDisabled ||
     !e.sessionTerminationAvailable)reasons.push('isolation');
  if(!Number.isSafeInteger(e.requestedWallSeconds) ||
     e.requestedWallSeconds<1 || e.requestedWallSeconds>PILOT_MAX_WALL_SECONDS)
    reasons.push('wall-time');
  return {approved:reasons.length===0,reasons,scopeDigest:digest};
}
/** Refuse to launch when any independent observation is missing or false. */
export function requirePilotAdmission(scope:TaskScope,e:PilotAdmissionEvidence):string {
  const decision=assessPilotAdmission(scope,e);
  requireControl(decision.approved && decision.scopeDigest!==null,
    'pilot-admission-denied');
  return decision.scopeDigest!;
}
