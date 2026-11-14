import {describe,it,expect} from "vitest";
import {admitRunner} from "../automation-runner-admission.ts";
import type {RunnerAdmission} from "../automation-runner-admission.ts";
const good:RunnerAdmission={
 sourceSha:"a".repeat(40),baseSha:"b".repeat(40),issue:68,taskId:"stage2",
 grantVerified:true,grantExpired:false,revoked:false,checkpointVerified:true,ledgerAvailable:true,
 implementationAttempts:1,repairAttemptsForFailure:0,isRepair:false,
 monthlySpentUsd:20,reservedUsd:5,estimatedNextRunUsd:3,activeRuns:0
};
describe("Stage 2 offline runner admission",()=>{
 it("allows only authenticated bounded tasks",()=>expect(admitRunner(good)).toMatchObject({allowed:true}));
 it.each([
  ["grantVerified",false],["grantExpired",true],["revoked",true],
  ["checkpointVerified",false],["ledgerAvailable",false],
  ["implementationAttempts",5],["activeRuns",1],
  ["monthlySpentUsd",44],["reservedUsd",Number.NaN],["estimatedNextRunUsd",Infinity],
  ["sourceSha","not-a-sha"]
 ] as const)("fails closed on %s", (field,value)=>{
  expect(admitRunner({...good,[field]:value}).allowed).toBe(false);
 });
 it("rejects third repair but permits second repair for a stable failure",()=>{
  expect(admitRunner({...good,isRepair:true,repairAttemptsForFailure:1}).allowed).toBe(true);
  expect(admitRunner({...good,isRepair:true,repairAttemptsForFailure:2}).allowed).toBe(false);
 });
 it("allows exactly the guard threshold, never more",()=>{
  expect(admitRunner({...good,monthlySpentUsd:37,reservedUsd:5,estimatedNextRunUsd:3}).allowed).toBe(true);
  expect(admitRunner({...good,monthlySpentUsd:37.01,reservedUsd:5,estimatedNextRunUsd:3}).allowed).toBe(false);
 });
});
