// Stage 2 offline runner admission policy. Advisory until authenticated owner grants,
// trusted checkpoints, usage receipts and revocation are wired to a trusted runner.
export type RunnerAdmission = {
  sourceSha: string; baseSha: string; issue: number; taskId: string;
  grantVerified: boolean; grantExpired: boolean; revoked: boolean;
  checkpointVerified: boolean; ledgerAvailable: boolean;
  implementationAttempts: number; repairAttemptsForFailure: number;
  isRepair: boolean; monthlySpentUsd: number; reservedUsd: number;
  estimatedNextRunUsd: number; activeRuns: number;
};
export type AdmissionDecision = {allowed:boolean;reason:string};
const sha=/^[a-f0-9]{40}$/;
const task=/^[a-z0-9][a-z0-9-]{0,79}$/;
export function admitRunner(input:RunnerAdmission):AdmissionDecision {
  const deny=(reason:string):AdmissionDecision=>({allowed:false,reason});
  if(!sha.test(input.sourceSha)||!sha.test(input.baseSha)||!Number.isSafeInteger(input.issue)||
    input.issue<1||!task.test(input.taskId))return deny("INVALID_TASK_IDENTITY");
  if(!input.grantVerified||input.grantExpired||input.revoked)return deny("NO_ACTIVE_VERIFIED_OWNER_GRANT");
  if(!input.checkpointVerified||!input.ledgerAvailable)return deny("NO_AUTHENTICATED_DURABLE_HISTORY");
  if(!Number.isSafeInteger(input.implementationAttempts)||input.implementationAttempts<0||
    !Number.isSafeInteger(input.repairAttemptsForFailure)||input.repairAttemptsForFailure<0)
    return deny("INVALID_ATTEMPT_COUNTER");
  if(input.isRepair ? input.repairAttemptsForFailure>=2 : input.implementationAttempts>=5)
    return deny("ATTEMPT_BUDGET_EXHAUSTED");
  if(!Number.isSafeInteger(input.activeRuns)||input.activeRuns!==0)return deny("CONCURRENT_RUN");
  const money=[input.monthlySpentUsd,input.reservedUsd,input.estimatedNextRunUsd];
  if(money.some(v=>!Number.isFinite(v)||v<0))return deny("UNKNOWN_OR_INVALID_USAGE");
  if(input.monthlySpentUsd+input.reservedUsd+input.estimatedNextRunUsd>45)
    return deny("MONTHLY_SPENDING_GUARD");
  return {allowed:true,reason:"ELIGIBLE_FOR_SEPARATE_AUTHORIZED_EXECUTION"};
}
