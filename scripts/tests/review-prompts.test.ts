import { readFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REVIEW_POLICY, list, object } from "../pr-review.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const review = read(".github/CODEX_REVIEW_PROMPT.md").replace(/\s+/g, " ");
const repair = read(".github/CODEX_REPAIR_PROMPT.md").replace(/\s+/g, " ");
const guide = read("docs/PR_REVIEW.md");
const handoff = object(JSON.parse(read(".github/PR_REVIEW_HANDOFF.template.json")));
const allowedLinks = new Set([".github/CODEX_ISSUE_PROMPT.md", ".github/CODEX_CLOUD_PROMPT.md", ".github/CODEX_REVIEW_PROMPT.md", ".github/CODEX_REPAIR_PROMPT.md",
  ".github/PR_REVIEW_HANDOFF.template.json", "docs/PR_REVIEW.md", "docs/CI.md", "docs/CODEX_WORKFLOW.md", "docs/CODEX_PIPELINE.md", "docs/AUTOMATION_014.md", "docs/OPTION_B_AUDIT.md"]);
function localLink(source: string, target: string): string {
  const path = resolve(root, dirname(source), target);
  // Validate before any existence/content read; links cannot probe credentials or arbitrary files.
  if (!allowedLinks.has(relative(root, path).replace(/\\/g, "/"))) throw new Error("Unexpected local documentation link target");
  return path;
}

// Static document/template regression guards only. No runtime validator, model invocation,
// authorization engine, command execution or guarantee of reviewer compliance is introduced.
describe("human-started review/repair templates", () => {
  it("defaults to unknown evidence and never grants repair authority", () => {
    expect(handoff).toMatchObject({ format: "sovereign-pr-review-v1", advisoryOnly: true,
      repairAuthorization: "NOT_GRANTED", repository: REVIEW_POLICY.repository });
    expect(object(handoff.outcome).decision).toBe("UNKNOWN");
    for (const key of ["findings", "repairHistory", "protectedScopeDecisions", "missingEvidence", "conflictingFeedback"]) expect(handoff[key]).toEqual([]);
  });
  it("requires a verified target pair and approval source rather than placeholder identity", () => {
    const identity = object(handoff.identity);
    for (const key of ["issueNumber", "prNumber", "branch", "expectedHeadSha", "expectedBaseSha", "observedHeadSha", "observedBaseSha", "verifiedAt"]) expect(identity).toHaveProperty(key, null);
    expect(identity.sources).toEqual([]); expect(object(handoff.approvedScope).ownerApprovalSource).toBeNull();
  });
  it("retains current-head workflow, source, association and attempt evidence for both required jobs", () => {
    const ci = object(handoff.ci);
    expect(ci.workflowPath).toBe(REVIEW_POLICY.workflow); expect(ci.event).toBe("pull_request");
    for (const key of ["workflowId", "repository", "headSha", "headRepository", "headBranch", "runId", "attempt", "runUrl"]) expect(ci).toHaveProperty(key, null);
    expect(ci.conclusion).toBe("UNKNOWN"); expect(ci.association).toEqual({ method: "UNKNOWN", verified: false, sources: [] });
    const jobs = list(ci.jobs).map(object); expect(jobs.map((job) => job.name)).toEqual([...REVIEW_POLICY.jobs]);
    for (const job of jobs) {
      expect(job).toMatchObject({ id: null, runId: null, attempt: null, conclusion: "UNKNOWN", evidenceUrl: null });
      expect(job.tests).toEqual({ passed: null, failed: null, skipped: null, pending: null, todo: null, sourceUrl: null, trust: "UNTRUSTED_RUNNER_REPORT" });
    }
  });
  it("does not mark an empty inventory or absent patch review complete", () => {
    expect(handoff.diff).toEqual({ headSha: null, baseSha: null, fileCount: null, fetchedCount: 0,
      inventoryComplete: false, diffReviewed: false, files: [], protectedFiles: [], limitations: [] });
    expect(handoff.checks).toEqual({ scope: "UNKNOWN", functionalCorrectness: "UNKNOWN", security: "UNKNOWN",
      authorization: "UNKNOWN", regressions: "UNKNOWN", tests: "UNKNOWN", documentation: "UNKNOWN" });
  });
  it("documents finding severity, classification, exact versioned source and actionable verification", () => {
    const example = guide.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    expect(example).not.toBeNull(); const finding = object(JSON.parse(example![1]!));
    expect(finding).toMatchObject({ id: "F1", classification: "POTENTIAL_RISK", severity: "MEDIUM", blocking: false });
    for (const key of ["trigger", "evidence", "impact", "recommendation", "verification", "limitations"]) expect(finding).toHaveProperty(key);
    expect(finding.location).toMatchObject({ side: "HEAD", startLine: 1, endLine: 3 });
    for (const key of ["path", "sha", "url"]) expect(object(finding.location)).toHaveProperty(key);
    expect(guide).toContain("not an observed defect");
  });
  it.each([
    ["review-only writes boundary", /REVIEW_ONLY[\s\S]*?Do not edit files[\s\S]*?execute PR code\/tests, commit, push, post reviews\/comments/],
    ["stale expected SHA rejection", /Known expected SHA mismatches[\s\S]*?STOP with UNKNOWN/],
    ["current-head CI provenance", /current-head CI workflow ID\/path[\s\S]*?latest attempt[\s\S]*?evidence links/],
    ["complete diff and protected scope", /COMPLETE diff[\s\S]*?old\/new rename paths[\s\S]*?Record every protected file and its approval source/],
    ["defect/risk/suggestion separation", /CONFIRMED_DEFECT[\s\S]*?POTENTIAL_RISK[\s\S]*?SUGGESTION[\s\S]*?exact file\/line and HEAD\/BASE SHA/],
    ["final evidence refresh", /Re-fetch head\/base, PR state and CI run\/attempt[\s\S]*?return UNKNOWN/],
    ["no automatic repair handoff", /Keep repairAuthorization=NOT_GRANTED[\s\S]*?STOP after the review[\s\S]*?separate explicit owner request/]
  ])("preserves %s", (_name, rule) => { expect(review).toMatch(rule); });

  it.each([
    ["specific owner authorization", /Approved finding IDs:[\s\S]*?Approved changes\/files and acceptance criteria:[\s\S]*?Authorized delivery:/],
    ["fresh identity and CI preflight", /Before editing, perform a read-only preflight:[\s\S]*?existing branch and current head\/base SHA[\s\S]*?current CI run\/attempt\/job/],
    ["stale/dirty/diverged safeguards", /STOP before editing[\s\S]*?clean working tree[\s\S]*?dirty\/diverged tree[\s\S]*?do not stash, reset, force-push/],
    ["existing branch and PR reuse", /Reuse the existing issue branch and existing draft PR[\s\S]*?Do not create another branch, PR or parallel worktree/],
    ["two separately requested attempts", /At most TWO human-initiated repair attempts per failure, each separately requested by the owner/],
    ["history cannot reset across PCs", /do not guess, reset the counter on a new SHA\/PC or rename a failure to evade the limit/],
    ["only approved scope and uncovered escalation", /OUTSIDE previously approved scope[\s\S]*?Address ONLY the approved findings/],
    ["independent review after repair", /set decision UNKNOWN pending an independent fresh review[\s\S]*?do not start a third attempt/]
  ])("preserves repair safeguard: %s", (_name, rule) => { expect(repair).toMatch(rule); });

  it.each([["review", review], ["repair", repair]])("treats %s inputs as untrusted and prohibits execution/credential/database escalation", (_name, prompt) => {
    expect(prompt).toContain("UNTRUSTED DATA"); expect(prompt).toMatch(/Never execute commands copied from/);
    expect(prompt).toMatch(/Do not access existing databases/); expect(prompt).toContain("AI model APIs");
    expect(prompt).toContain("unattended execution"); expect(prompt).toContain(".env");
    expect(prompt).toContain("trusted"); expect(prompt).toContain("NOT_GRANTED");
    expect(prompt).not.toMatch(/\bcodex\s+(exec|cloud)\b|@codex\b|gh\s+workflow\s+run/);
  });
  it.each([
    ["BLOCKED", /owner decision/],
    ["CHANGES REQUESTED", /blocking confirmed defect or current-head required-check failure/],
    ["UNKNOWN", /cannot be verified/],
    ["READY", /complete diff[\s\S]*?required current-head CI checks pass[\s\S]*?Green CI alone is insufficient/]
  ])("defines conservative %s decision criteria", (decision, rule) => {
    const row = guide.split(/\r?\n/).filter((line) => line.startsWith(`| ${decision} |`));
    expect(row).toHaveLength(1); expect(row[0]).toMatch(rule);
  });
  it("retains PC/session and credential safeguards and append-only repair evidence", () => {
    for (const phrase of ["Stop the previous Codex session", "Never synchronize `.env`, tokens, credentials", "head/base/CI", "failure's history", "oldHeadSha", "newHeadSha", "oldBaseSha", "newBaseSha", "unresolvedFindingIds"]) expect(guide).toContain(phrase);
    expect(guide).toContain("not an executable schema, authorization token or runtime validator");
  });
  it("keeps all local prompt/template/guide links resolvable", () => {
    for (const path of [".github/CODEX_REVIEW_PROMPT.md", ".github/CODEX_REPAIR_PROMPT.md", "docs/PR_REVIEW.md", "docs/CODEX_WORKFLOW.md"]) {
      for (const match of read(path).matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1]!; if (/^https?:/.test(target)) continue;
        const [file, anchor] = target.split("#"); const linked = localLink(path, file!);
        expect(existsSync(linked), `${path} -> ${target}`).toBe(true);
        if (anchor) {
          const headings = readFileSync(linked, "utf8").split(/\r?\n/).filter((line) => /^#{1,6} /.test(line))
            .map((line) => line.replace(/^#+ /, "").toLowerCase().replace(/[^\w -]/g, "").replace(/ /g, "-"));
          expect(headings, `${path} -> ${target}`).toContain(anchor);
        }
      }
    }
  });
  it.each(["../../.env", "../.git/config", "../scripts/development.ts"])("rejects out-of-scope documentation link %s before file access", (target) => {
    expect(() => localLink("docs/PR_REVIEW.md", target)).toThrow("Unexpected local documentation link target");
  });
});
