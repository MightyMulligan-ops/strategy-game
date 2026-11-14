// Stage 1 fixtures only: no live reviewer, authority, agent, CI or database.
import { describe, it, expect } from "vitest";
import { coordinationEvidence, object, list, reviewTriage, LIMITS } from "../pr-review.ts";
import { orchestrate, renderOwnerHandoff, reviewDigest } from "../pr-orchestration.ts";
import { collectReview, reviewArtifacts } from "../pr-review-github.ts";
import { orchestrationFixture, confirmed, repairRecord } from "./pr-orchestration-fixture.ts";
import { acceptanceFixture } from "./pr-acceptance-fixture.ts";
const claim = (taskId = "synthetic-task", id = 71) => ({ id, body: `Task ID: ${taskId}\nHistory: unverified external reference` });
const metadata = () => coordinationEvidence([claim()], 1, 32);

describe("Automation015 Stage1 unified intake and owner handoff", () => {
  it("consolidates scope/claim/source/jobs/paths/history/review gaps into the same artifacts with one prompt", async () => {
    const f = acceptanceFixture(); f.comments[0]!.body += '\nTask ID: synthetic-task\nHistory: candidate record';
    const report = await collectReview(f.api, f.request), calls = [...f.calls], out = reviewArtifacts(report, '2026-11-14T12:00:00Z');
    expect(f.calls).toEqual(calls); expect(report.evidence!.coordination).toEqual(metadata());
    for (const text of [out.markdown, out.handoff]) {
      for (const term of ['Automation 015 Stage 1','synthetic-task','issuecomment-71','sha256:','job 201','job 202','UNTRUSTED_RUNNER_REPORT','archive/old.sql (from database/prisma/migrations/example/migration.sql)','Reviewer identity/independence/provenance UNKNOWN','Next owner action:']) expect(text).toContain(term);
      expect([...text.matchAll(/```text\n(REVIEW_ONLY[^]*?)\n```/g)]).toHaveLength(1);
      expect(text).not.toMatch(/private-prose|private-comment-prose|evil\.test/);
    }
    const packet = JSON.parse(out.handoff.match(/```json\n([^\n]+)\n```/)![1]!);
    expect(packet.format).toBe('sovereign-pr-acceptance-v1'); expect(packet.triage.format).toBe('sovereign-pr-triage-v1'); expect(packet.acceptanceDecision).toBe('NOT_MADE');
  });
  it.each(['absent verifier','JSON-shaped verifier','rejecting verifier','throwing verifier','missing reviewer','self reviewer','wrong author','wrong task','tampered digest','missing receipt'])('requires external corroboration rather than %s', async kind => {
    const f = await orchestrationFixture(), input = f.input();
    if (kind==='absent verifier') delete f.m.verifyReviewProvenance;
    if (kind==='JSON-shaped verifier') f.m.verifyReviewProvenance = true as never;
    if (kind==='rejecting verifier') f.m.verifyReviewProvenance = () => false;
    if (kind==='throwing verifier') f.m.verifyReviewProvenance = () => { throw Error('Bearer private-token'); };
    if (kind==='missing reviewer') delete f.m.independentReview!.reviewer;
    if (kind==='self reviewer') f.m.independentReview!.reviewer = 'SYNTHETIC-AUTHOR';
    if (kind==='wrong author') f.m.independentReview!.implementationAuthor='different-author';
    if (kind==='wrong task') f.m.independentReview!.taskId='different-task';
    if (kind==='tampered digest') f.m.independentReview!.reviewDigest='sha256:'+'b'.repeat(64);
    if (kind==='missing receipt') delete f.m.independentReview;
    const r=orchestrate(input,f.o,f.m); expect(r.reviewCompleted).toBe(false); expect(r.recommendation).toBe('UNKNOWN'); expect(r.repairs).toEqual([]); expect(renderOwnerHandoff(r)).not.toContain('private-token');
  });
  it('binds the whole review, task, identities and CI to an immutable verification request', async () => {
    const f=await orchestrationFixture(),i=f.input(), original=f.m.verifyReviewProvenance!; let calls=0;
    f.m.verifyReviewProvenance=p=>{calls++;expect(p).toMatchObject({reviewer:'synthetic-reviewer',implementationAuthor:'synthetic-author',reviewDigest:reviewDigest(i.review!),taskId:f.o.taskId,head:f.o.head,base:f.o.base,runId:100,attempt:1});expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.jobIds)).toBe(true);return original(p);};
    const r=orchestrate(i,f.o,f.m);expect(calls).toBe(1);expect(r.reviewCompleted).toBe(true);expect(r.recommendation).toBe('READY');expect(r.readyMerge).toBe('NOT_GRANTED');expect(r.deployment).toBe('NOT_GRANTED');
    expect(renderOwnerHandoff(r)).toContain('Externally corroborated reviewer synthetic-reviewer');
  });
  it('does not deserialize a review PASS or owner/reviewer claims into external verification', async () => {
    const f=await orchestrationFixture();object(f.review.identity).reviewer='trusted';f.review.verified=true;f.review.verifyReviewProvenance=true;delete f.m.verifyReviewProvenance;
    const r=orchestrate(f.input(),f.o,f.m);expect(r.reviewCompleted).toBe(false);expect(r.recommendation).toBe('UNKNOWN');
  });
  it.each(['changed head','changed base','changed main','newer failed attempt','different job','missing job','missing counts','rename omitted'])('withholds acceptance for %s after collection',async kind=>{
    const f=await orchestrationFixture();
    if(kind==='changed head')f.o.head='b'.repeat(40);if(kind==='changed base')f.o.base='b'.repeat(40);if(kind==='changed main')f.o.currentMain='b'.repeat(40);
    if(kind==='newer failed attempt')f.o.attempt=2;if(kind==='different job')f.o.jobIds=[301,302];
    if(kind==='missing job')list(object(f.p.ci).jobs).pop();if(kind==='missing counts')object(list(object(f.p.ci).jobs)[0]).tests=null;
    if(kind==='rename omitted')object(list(object(f.review.diff).files).at(-1)).previousPath=null;
    expect(orchestrate(f.input(),f.o,f.m).recommendation).not.toBe('READY');
  });
  it('uses a newer failed attempt instead of the older success through the existing collector',async()=>{
    const f=acceptanceFixture();f.run.run_attempt=2;f.run.conclusion='failure';f.quality.run_attempt=f.database.run_attempt=2;f.quality.conclusion='failure';
    const r=await collectReview(f.api,f.request);expect(r.ci?.attempt).toBe(2);expect(r.ci?.conclusion).toBe('failure');expect(r.ci?.jobs[0]?.conclusion).toBe('failure');
    expect(reviewArtifacts(r,'2026-11-14T12:00:00Z').handoff).not.toContain('**READY — advisory');
  });
  it.each(['competing','incomplete','wrong issue','wrong task','malformed','oversized'])('fails closed on %s coordination metadata without trusting it as a grant',async kind=>{
    const f=await orchestrationFixture();let c=metadata();
    if(kind==='competing')c=coordinationEvidence([claim(),claim('other-task',72)],2,32);
    if(kind==='incomplete')c=coordinationEvidence([claim()],2,32);
    if(kind==='wrong issue')c=coordinationEvidence([claim()],1,999);
    if(kind==='wrong task')c=coordinationEvidence([claim('other-task')],1,32);
    const raw=kind==='malformed'?'{' : kind==='oversized'?' '.repeat(LIMITS.packetBytes+1):JSON.stringify(c);
    const r=orchestrate({...f.input(),coordination:raw},f.o,f.m);expect(r.recommendation).not.toBe('READY');
  });
  it('collects references despite approval-source limits; marks partial comment inventories incomplete',async()=>{
    const f=acceptanceFixture();f.issue.comments=12;f.comments.splice(0,1,...Array.from({length:11},(_,n)=>({id:71+n,body:'Authorization: candidate'})),claim('late-task',99));
    const report=await collectReview(f.api,f.request);expect(report.evidence!.coordination?.taskId).toBe('late-task');
    f.issue.comments=13;expect((await collectReview(f.api,f.request)).evidence!.coordination?.complete).toBe(false);
  });
  it('sanitizes candidate metadata and never treats absent history as zero attempts',async()=>{
    const f=await orchestrationFixture();const c=coordinationEvidence([{id:71,body:'Task ID: bad\n```\nBearer private-token\nHistory: https://evil.test/secret'}],1,32);
    const i=f.input();delete i.history;const r=orchestrate({...i,coordination:JSON.stringify(c)},f.o,f.m);expect(r.implementationRemaining).toBeNull();expect(r.history).toBeNull();
    expect(renderOwnerHandoff(r)).not.toMatch(/private-token|evil\.test/);expect(renderOwnerHandoff(r)).toContain('UNKNOWN/5');
  });
  it('retains exhausted correction/repair budgets, scoped proposals and finding classifications',async()=>{
    const f=await orchestrationFixture();f.history.implementationPasses=Array.from({length:5},(_,n)=>({pass:n+1,taskId:f.o.taskId,head:f.o.head,base:f.o.base,ownerSource:f.m.owner!.source,failureId:'BUILD',result:'synthetic correction'}));
    f.history.repairs=[repairRecord(f,1),repairRecord(f,2)];f.review.repairHistory=f.history.repairs;f.review.findings=[confirmed(f),confirmed(f,{id:'SUGGESTION-001',classification:'SUGGESTION',blocking:false})];
    const r=orchestrate({...f.input(),requestImplementationCorrection:true},f.o,f.m);expect(r.recommendation).toBe('BLOCKED');expect(r.implementationRemaining).toBe(0);expect(r.repairs[0]!.attempt).toBeNull();expect(r.repairs).toHaveLength(1);
    const text=renderOwnerHandoff(r);expect(text).toContain('SUGGESTION-001: SUGGESTION');expect(text).toContain('no third attempt');expect(text).toContain('Next owner action:');
  });
  it('rejects scope drift and contradictory/missing provenance even when caller flags PASS',async()=>{
    const f=await orchestrationFixture();f.m.owner!.scopeDigest='sha256:'+'b'.repeat(64);expect(orchestrate(f.input(),f.o,f.m).recommendation).toBe('BLOCKED');
    f.m.owner!.scopeDigest=f.o.scopeDigest;delete f.m.historySource;expect(orchestrate(f.input(),f.o,f.m).reviewCompleted).toBe(false);
  });
});
