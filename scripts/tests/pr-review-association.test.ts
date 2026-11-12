import { describe, expect, it } from "vitest";
import { collectReview } from "../pr-review-github.ts";
import { renderReview } from "../pr-review.ts";
import { reviewFixture } from "./pr-review-fixture.ts";

type Fixture = ReturnType<typeof reviewFixture>;
function missingAssociation() { const f = reviewFixture(); f.run.pull_requests = []; return f; }
const invalid: [string, (f: Fixture) => void][] = [
  ["wrong head SHA", (f) => { f.run.head_sha = "b".repeat(40); }],
  ["wrong workflow ID", (f) => { f.run.workflow_id = 2; }],
  ["wrong workflow path", (f) => { f.run.path = ".github/workflows/untrusted.yml"; }],
  ["wrong event", (f) => { f.run.event = "push"; }],
  ["wrong repository", (f) => { f.run.repository.full_name = "outsider/repo"; }],
  ["wrong head repository", (f) => { f.run.head_repository.full_name = "outsider/repo"; }],
  ["wrong branch", (f) => { f.run.head_branch = "another-branch"; }],
  ["missing branch", (f) => { Reflect.deleteProperty(f.run, "head_branch"); }],
  ["empty branch", (f) => { f.run.head_branch = ""; }],
  ["fork fallback", (f) => { f.run.head_repository.full_name = f.pr.head.repo.full_name = "outsider/fork"; }],
  ["conflicting explicit association", (f) => { f.run.pull_requests = [{ number: 99 }]; }],
  ["ambiguous explicit association", (f) => { f.run.pull_requests = [{ number: 33 }, { number: 99 }]; }],
  ["no commit candidate", (f) => { f.commitPRs.length = 0; }],
  ["multiple commit candidates", (f) => { f.commitPRs.push({ number: 99 }); }],
  ["duplicate commit candidates", (f) => { f.commitPRs.push({ number: 33 }); }],
  ["invalid candidate number", (f) => { f.commitPRs[0]!.number = -1; }]
];

describe("missing CI run PR associations", () => {
  it.each(["workflow_dispatch", "workflow_run"])("recovers merged PR #33 success via %s without an association array", async (event) => {
    const f = reviewFixture();
    f.pr.head.sha = "9f59b9652189e57371d0f93bde22fe652f87c572";
    f.pr.state = "closed"; f.pr.merged = true; f.pr.draft = false;
    f.run.id = 43265346907; f.run.head_sha = f.pr.head.sha; f.run.pull_requests = []; f.run.conclusion = "success";
    f.quality.run_id = f.run.id; f.database.run_id = f.run.id; f.quality.conclusion = "success"; f.quality.steps = [];
    f.logs.set(201, "Tests 701 passed | 73 skipped (774)");
    const report = await collectReview(f.api, { ...f.request, event, run: f.run.id });
    expect(report.state).toBe("merged");
    expect(report.ci).toMatchObject({ id: 43265346907, attempt: 1, conclusion: "success" });
    expect(report.ci?.jobs).toHaveLength(2);
    expect(report.ci?.jobs.map((job) => job.conclusion)).toEqual(["success", "success"]);
    expect(report.ci?.jobs[1]?.tests?.passed).toBe(73);
    expect(f.calls).toContain(`/repos/MightyMulligan-ops/strategy-game/commits/${f.pr.head.sha}/pulls?per_page=2`);
    expect(renderReview(report)).toContain("untrusted runner-reported evidence");
  });

  it.each(invalid)("withholds manual CI evidence for %s", async (_name, mutate) => {
    const f = missingAssociation(); mutate(f);
    expect((await collectReview(f.api, f.request)).ci).toBeNull();
    expect(f.calls.some((path) => path.startsWith("log:"))).toBe(false);
  });
  it.each(invalid)("rejects automatic attribution for %s", async (_name, mutate) => {
    const f = missingAssociation(); mutate(f);
    await expect(collectReview(f.api, { ...f.request, event: "workflow_run", run: 100 })).rejects.toThrow();
    expect(f.calls.some((path) => path.startsWith("log:"))).toBe(false);
  });
  it.each(["base branch", "base repository"])("rejects a wrong %s before collecting evidence", async (kind) => {
    for (const event of ["workflow_dispatch", "workflow_run"]) {
      const f = missingAssociation();
      if (kind === "base branch") f.pr.base.ref = "other"; else f.pr.base.repo.full_name = "outsider/repo";
      await expect(collectReview(f.api, { ...f.request, event, run: 100 })).rejects.toThrow();
      expect(f.calls.some((path) => path.startsWith("log:"))).toBe(false);
    }
  });
  it.each(["lookup error", "malformed list", "stale candidate", "wrong candidate branch", "wrong candidate repository"])("fails closed on %s", async (kind) => {
    for (const event of ["workflow_dispatch", "workflow_run"]) {
      const f = missingAssociation(); const get = f.api.get; let lookups = 0;
      f.api.get = async (path) => {
        if (path.includes("/commits/")) {
          lookups++;
          if (kind === "lookup error") throw new Error("secret-token do not print");
          if (kind === "malformed list") return { message: "secret-token do not print" };
        }
        if (lookups && path.endsWith("/pulls/33")) {
          const candidate = structuredClone(f.pr);
          if (kind === "stale candidate") candidate.head.sha = "b".repeat(40);
          if (kind === "wrong candidate branch") candidate.head.ref = "another-branch";
          if (kind === "wrong candidate repository") candidate.head.repo.full_name = "outsider/repo";
          // Return the bad candidate only for recovery; preserve the final requested-PR read.
          lookups = 0; return candidate;
        }
        return get(path);
      };
      if (event === "workflow_run") await expect(collectReview(f.api, { ...f.request, event, run: 100 })).rejects.toThrow("CI association unavailable");
      else {
        const report = await collectReview(f.api, f.request);
        expect(report.ci).toBeNull(); expect(renderReview(report)).toContain("verify the PR/run manually");
        expect(renderReview(report)).not.toContain("secret-token");
      }
    }
  });
  it("does not reinterpret conflicting explicit associations using the fallback", async () => {
    const f = missingAssociation(); f.run.pull_requests = [{ number: 99 }];
    expect((await collectReview(f.api, f.request)).ci).toBeNull();
    expect(f.calls.some((path) => path.includes("/commits/"))).toBe(false);
  });
  it("does not select an older success when the newest same-source run is ambiguous", async () => {
    const f = missingAssociation(); const old = structuredClone(f.run); old.id = 99; old.pull_requests = [{ number: 33 }]; old.conclusion = "success";
    f.runs.workflow_runs.push(old); f.runs.total_count = 2; f.commitPRs.push({ number: 99 });
    expect((await collectReview(f.api, f.request)).ci).toBeNull();
    expect(f.calls.some((path) => path.includes("/actions/runs/99"))).toBe(false);
  });
  it("requires the requested PR, not another unique commit candidate", async () => {
    const f = missingAssociation(); f.commitPRs[0]!.number = 99; const get = f.api.get;
    f.api.get = async (path) => path.endsWith("/pulls/99") ? { ...structuredClone(f.pr), number: 99 } : get(path);
    expect((await collectReview(f.api, f.request)).ci).toBeNull();
  });
  it("revalidates uniqueness before publishing, rather than caching the first lookup", async () => {
    const f = missingAssociation(); const get = f.api.get; let lookups = 0;
    f.api.get = async (path) => {
      if (path.includes("/commits/") && ++lookups === 3) f.commitPRs.push({ number: 99 });
      return get(path);
    };
    await expect(collectReview(f.api, f.request)).rejects.toThrow("CI changed during report");
    expect(lookups).toBe(3);
  });
  it.each(["branch", "source repository", "attempt"])("rejects changed run %s during fallback evidence collection", async (kind) => {
    const f = missingAssociation(); const get = f.api.get; let reads = 0;
    f.api.get = async (path) => {
      if (path.endsWith("/actions/runs/100") && ++reads === 2) {
        if (kind === "branch") f.run.head_branch = "another-branch";
        if (kind === "source repository") f.run.head_repository.full_name = "outsider/repo";
        if (kind === "attempt") f.run.run_attempt++;
      }
      return get(path);
    };
    await expect(collectReview(f.api, f.request)).rejects.toThrow("CI changed during report");
  });
  it("still requires job attempt identity on recovered runs", async () => {
    const f = missingAssociation(); f.quality.run_attempt = 2;
    await expect(collectReview(f.api, f.request)).rejects.toThrow("Job attempt mismatch");
  });
  it("rejects an automatic trigger response with the wrong run ID", async () => {
    const f = missingAssociation(); const get = f.api.get;
    f.api.get = async (path) => path.endsWith("/actions/runs/100") ? { ...f.run, id: 101 } : get(path);
    await expect(collectReview(f.api, { ...f.request, event: "workflow_run", run: 100 })).rejects.toThrow("CI trigger scope rejected");
  });
  it.each(["branch", "source repository"])("rechecks PR %s at publication, including explicitly associated runs", async (kind) => {
    const f = reviewFixture(); const get = f.api.get; let reads = 0;
    f.api.get = async (path) => {
      if (path.endsWith("/pulls/33") && ++reads === 2) {
        if (kind === "branch") f.pr.head.ref = "another-branch"; else f.pr.head.repo.full_name = "outsider/repo";
      }
      return get(path);
    };
    await expect(collectReview(f.api, f.request)).rejects.toThrow("PR changed during report");
  });
  it("does not loosen authorization or log sanitization when recovering evidence", async () => {
    const f = missingAssociation(); const get = f.api.get;
    f.api.get = async (path) => path.includes("/permission") ? { permission: "read" } : get(path);
    await expect(collectReview(f.api, f.request)).rejects.toThrow("Maintainer dispatch required");
    expect(f.calls).toHaveLength(0);
    const g = missingAssociation(); const text = renderReview(await collectReview(g.api, g.request));
    for (const secret of ["secret-title", "private prose", "user:pass", "do-not-repeat", "token-secret", "::warning::"]) expect(text).not.toContain(secret);
    expect(text).toContain("TypeScript TS2339");
  });
});
