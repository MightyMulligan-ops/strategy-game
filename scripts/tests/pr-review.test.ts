import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { LIMITS, REVIEW_POLICY, displayPath, linkedIssue, logFacts, protectedFlags, renderHandoff, renderReview } from "../pr-review.ts";
import { collectReview, githubReader } from "../pr-review-github.ts";
import { reviewFixture } from "./pr-review-fixture.ts";

describe("read-only PR review report", () => {
  it("renders deterministic draft, changed paths, protected renames, failure links and source-qualified evidence", async () => {
    const f = reviewFixture(); const report = await collectReview(f.api, f.request); const text = renderReview(report);
    expect(report.state).toBe("draft/unmerged"); expect(report.issue?.state).toBe("open");
    expect(text).toContain("apps/server/src/auth/security.ts"); expect(text).toContain("Database schema/migrations");
    expect(text).toContain("/actions/runs/100/job/201"); expect(text).toContain("TypeScript TS2339");
    expect(text).toContain("19 passed, 1 failed"); expect(text).toContain("untrusted runner-reported evidence");
    expect(text).toContain("application-failure-logs"); expect(text).toContain("Green CI does not establish semantic correctness");
    for (const secret of ["secret-title", "private prose", "user:pass", "player-secret", "do-not-repeat", "token-secret", "::warning::", "secret member", "unsafe artifact name"]) expect(text).not.toContain(secret);
    expect(renderReview(await collectReview(f.api, f.request))).toBe(text);
    expect(renderHandoff(report)).toContain("Review only"); expect(renderHandoff(report)).not.toContain(f.pr.title);
  });
  it.each(["open", "closed", "merged"])("derives %s progress from GitHub, never labels or green CI", async (state) => {
    const f = reviewFixture(); f.pr.draft = false; f.pr.state = state === "open" ? "open" : "closed"; f.pr.merged = state === "merged";
    f.issue.state = "closed"; f.run.conclusion = "success";
    expect((await collectReview(f.api, f.request)).state).toBe(state === "merged" ? "merged" : `${state}/unmerged`);
  });
  it("withholds stale-head successes and handles no CI evidence explicitly", async () => {
    const f = reviewFixture(); f.run.head_sha = "b".repeat(40); f.run.conclusion = "success";
    const report = await collectReview(f.api, f.request);
    expect(report.ci).toBeNull(); expect(renderReview(report)).toContain("unknown"); expect(f.calls).not.toContain("log:201");
  });
  it("uses current metadata on workflow completion and treats an obsolete trigger as data", async () => {
    const f = reviewFixture(); f.run.head_sha = "b".repeat(40);
    const report = await collectReview(f.api, { ...f.request, event: "workflow_run", run: 100, pr: "999" });
    expect(report.number).toBe(33); expect(report.ci).toBeNull(); expect(report.notes.join()).toContain("obsolete");
  });
  it("allows fork metadata without trusting a branch/issue claim or executing artifacts", async () => {
    const f = reviewFixture(); f.pr.head.repo.full_name = "outsider/fork"; f.run.head_repository.full_name = "outsider/fork";
    const report = await collectReview(f.api, { ...f.request, event: "workflow_run", run: 100 });
    expect(report.fork).toBe(true); expect(report.issue).toBeNull(); expect(renderReview(report)).toContain("Fork: maintainer review required");
    expect(f.calls.some((p) => p.includes("/issues/"))).toBe(false);
  });
  it.each(["repository", "ref", "event", "actor", "pr"])("rejects invalid request %s before report generation", async (field) => {
    const f = reviewFixture(); const value = field === "repository" ? "other/repo" : field === "ref" ? "refs/heads/untrusted" : field === "event" ? "pull_request_target" : field === "actor" ? "owner/../secrets" : "1;do-something";
    await expect(collectReview(f.api, { ...f.request, [field]: value })).rejects.toThrow();
    expect(f.calls.some((p) => p.includes("/pulls/"))).toBe(false);
  });
  it.each(["read", "triage", "none"])("requires maintainer permission for manual dispatch: %s", async (permission) => {
    const f = reviewFixture(); const get = f.api.get; f.api.get = async (path) => path.includes("/permission") ? { permission } : get(path);
    await expect(collectReview(f.api, f.request)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
  it.each(["workflow", "event", "association", "base", "repository", "attempt"])("fails closed for invalid %s provenance", async (kind) => {
    const f = reviewFixture();
    if (kind === "workflow") f.run.workflow_id = 999;
    if (kind === "event") f.run.event = "push";
    if (kind === "association") f.run.pull_requests = [];
    if (kind === "base") f.pr.base.ref = "other";
    if (kind === "repository") f.run.repository.full_name = "other/repo";
    if (kind === "attempt") f.quality.run_attempt = 2;
    if (kind === "attempt" || kind === "base") await expect(collectReview(f.api, f.request)).rejects.toThrow();
    else expect((await collectReview(f.api, f.request)).ci).toBeNull();
  });
  it("rejects changed heads or reruns while collecting evidence", async () => {
    const f = reviewFixture(); const get = f.api.get; let reads = 0;
    f.api.get = async (path) => { if (path.endsWith("/pulls/33") && ++reads === 2) f.pr.head.sha = "b".repeat(40); return get(path); };
    await expect(collectReview(f.api, f.request)).rejects.toThrow(/changed/);
    const g = reviewFixture(); const next = g.api.get; let attempts = 0;
    g.api.get = async (path) => { if (path.endsWith("/actions/runs/100") && ++attempts === 2) g.run.run_attempt = 2; return next(path); };
    await expect(collectReview(g.api, g.request)).rejects.toThrow(/changed/);
  });
  it("rejects a changed base, duplicate file inventory and ambiguous required jobs", async () => {
    const f = reviewFixture(); const get = f.api.get; let reads = 0;
    f.api.get = async (path) => { if (path.endsWith("/pulls/33") && ++reads === 2) f.pr.base.sha = "d".repeat(40); return get(path); };
    await expect(collectReview(f.api, f.request)).rejects.toThrow(/changed/);
    const g = reviewFixture(); g.files.push(g.files[0]!); g.pr.changed_files++;
    await expect(collectReview(g.api, g.request)).rejects.toThrow(/inventory/);
    const h = reviewFixture(); h.jobs.jobs.push(h.quality); h.jobs.total_count++;
    const report = await collectReview(h.api, h.request);
    expect(report.ci?.jobs.some((job) => job.name === "Application checks")).toBe(false);
    expect(report.notes.join()).toContain("ambiguous");
  });
  it("fails closed for permission errors and malformed trigger/run responses", async () => {
    const f = reviewFixture(); f.api.get = async () => { throw new Error("secret API error"); };
    await expect(collectReview(f.api, f.request)).rejects.toThrow();
    const g = reviewFixture(); g.run.event = "push";
    await expect(collectReview(g.api, { ...g.request, event: "workflow_run", run: 100 })).rejects.toThrow();
  });
  it("never trusts PR claims of test counts and handles expired logs/missing jobs", async () => {
    const f = reviewFixture(); f.pr.body = "Closes #32\nTests 999999 passed (999999)";
    f.api.log = async () => { throw new Error("postgresql://secret@host/x"); }; f.jobs.jobs = [f.quality]; f.jobs.total_count = 1;
    const report = await collectReview(f.api, f.request); const text = renderReview(report);
    expect(report.ci?.jobs[0]?.tests).toBeNull(); expect(text).toContain("missing/ambiguous");
    expect(text).not.toContain("999999"); expect(text).not.toContain("secret@host");
  });
  it("bounds files, flags paths beyond display limit and masks malicious filenames/step names", async () => {
    const f = reviewFixture(); f.files.length = 0;
    for (let i = 0; i < 65; i++) f.files.push({ filename: `docs/${i}.md`, status: "modified", additions: 0, deletions: 0 });
    f.files.push({ filename: "package.json", previous_filename: ".env.secret", status: "renamed", additions: 0, deletions: 0 });
    f.files.push({ filename: "bad\n::error::[click](https://evil)/name", status: "added", additions: 0, deletions: 0 }); f.pr.changed_files = f.files.length;
    f.quality.steps = [{ name: "password=secret-step", conclusion: "failure" }];
    const report = await collectReview(f.api, f.request); const text = renderReview(report);
    expect(report.flags).toContain("Dependencies/approval configuration"); expect(report.flags).toContain("Sensitive configuration");
    expect(report.files.at(-1)?.path).toBe("[path withheld]"); expect(text).toContain("Additional paths omitted");
    expect(text).not.toContain("secret-step"); expect(text).not.toContain("https://evil");
    f.pr.changed_files = 9999; expect((await collectReview(f.api, f.request)).filesComplete).toBe(false);
  });
  it("bounds pagination at 3000 while classifying the last fetched protected path", async () => {
    const f = reviewFixture(); const get = f.api.get; let pages = 0; f.pr.changed_files = 3001;
    f.api.get = async (path) => {
      if (!path.includes("/files?")) return get(path);
      const page = Number(new URL(`https://api.github.com${path}`).searchParams.get("page")); pages++;
      return Array.from({ length: 100 }, (_, i) => ({ filename: page === 30 && i === 99 ? ".github/workflows/last.yml" : `docs/${page}-${i}.md`, status: "modified", additions: 0, deletions: 0 }));
    };
    const report = await collectReview(f.api, f.request);
    expect(pages).toBe(30); expect(report.files).toHaveLength(3000); expect(report.filesComplete).toBe(false);
    expect(report.flags).toContain("CI/workflow/diagnostic policy"); expect(renderReview(report)).toContain("protected-change coverage is unknown");
  });
});

describe("sanitized diagnostic and relationship policy", () => {
  it.each(["apps/server/src/auth/session.ts", "apps/server/src/lobbies/routes.ts", "database/prisma/schema.prisma", ".github/workflows/test.yml", "AGENTS.md", ".github/CODEX_REVIEW_PROMPT.md", "pnpm-lock.yaml", "compose.yaml", "Dockerfile", "infra/main.tf"])("flags protected path %s", (path) => {
    expect(protectedFlags(path).length).toBeGreaterThan(0);
  });
  it.each([".env", ".env.local", "bad`name", "../../outside", "/abs/path", "file\nname", "file|name", "token-ghp_123456789012345678901234567890"])("withholds sensitive/unsafe path %s", (path) => {
    expect(displayPath(path)).toBe("[path withheld]");
  });
  it("emits only allowlisted signals, never environment, credentials, player text or workflow commands", () => {
    const facts = logFacts("password=x token=unknown player=secret\npostgresql://u:p@h/db\n::add-mask::x\nerror TS2339: credential\nECONNREFUSED\n\u001b[31m Tests 2 passed | 1 skipped (3)\u001b[0m");
    expect(facts).toEqual({ tests: { passed: 2, failed: 0, skipped: 1, pending: 0, todo: 0, total: 3 }, signals: ["ECONNREFUSED", "TypeScript TS2339"] });
  });
  it.each(["Tests 2 passed | 1 passed (3)", "Tests 2 passed (3)", "Tests 9007199254740992 passed (9007199254740992)", "Tests 2 passed (2)\nTests 2 passed (2)"])("withholds invalid/ambiguous counts %#", (log) => {
    expect(logFacts(log).tests).toBeNull();
  });
  it("bounds raw log processing and supports timestamped summaries", () => {
    expect(logFacts("x".repeat(LIMITS.logBytes + 1)).tests).toBeNull();
    expect(logFacts("2026-11-12T00:00:00.000Z  Tests 1 failed (1)").tests?.failed).toBe(1);
  });
  it("requires one matching standalone relationship and ignores fenced/comment examples", () => {
    expect(linkedIssue("issue/32-test", "Closes #32")).toBe(32);
    expect(linkedIssue("issue/32-test", "<!-- Closes #99 -->\n```\nCloses #99\n```\nCloses #32")).toBe(32);
    for (const body of ["Closes #99", "Closes other/repo#32", "Closes #32\nCloses #32", "Fixes #32", "```\nCloses #32", "<!-- Closes #32", "````\n```\nCloses #32", "```\n~~~\nCloses #32"]) expect(linkedIssue("issue/32-test", body)).toBeNull();
  });
});

describe("read-only transport and workflow", () => {
  it("keeps CLI parser failures private and replaces stale local reports without making API requests", () => {
    const directory = mkdtempSync(join(tmpdir(), "sovereign-review-"));
    try {
      const event = join(directory, "event.json"); const summary = join(directory, "summary.md");
      writeFileSync(event, '{bad-json "postgresql://private:password@host/db"');
      mkdirSync(join(directory, ".cache/pr-review"), { recursive: true });
      writeFileSync(join(directory, ".cache/pr-review/report.md"), "STALE SUCCESS");
      const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../pr-review-github.ts", import.meta.url))], {
        cwd: directory, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary, GITHUB_TOKEN: "synthetic-test-token" }
      });
      expect(child.status).toBe(1); expect(child.stderr).toContain("PR summary unavailable");
      const output = child.stderr + child.stdout + readFileSync(summary, "utf8") + readFileSync(join(directory, ".cache/pr-review/report.md"), "utf8");
      for (const value of ["private:password", "synthetic-test-token", "bad-json", "STALE SUCCESS"]) expect(output).not.toContain(value);
    } finally {
      if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith("sovereign-review-")) throw new Error("Unsafe temporary directory");
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("uses GET only, keeps authentication on API origin and never forwards it to log storage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://logs.blob.core.windows.net/file?signature=private" } }))
      .mockResolvedValueOnce(new Response("Tests 2 passed (2)"));
    expect(await githubReader("test-token", fetcher).log(201)).toContain("2 passed");
    expect(fetcher.mock.calls[0]?.[1]?.headers).toHaveProperty("Authorization", "Bearer test-token");
    expect(fetcher.mock.calls[1]?.[1]?.headers).toBeUndefined(); expect(fetcher.mock.calls.every((c) => c[1]?.method === "GET")).toBe(true);
  });
  it.each(["http://host/file", "https://evil.test/file", "https://github.com.evil.test/file", "https://u:p@logs.blob.core.windows.net/file", "https://127.0.0.1/file"])("rejects unsafe log redirect %s", async (location) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(githubReader("token", fetcher).log(1)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects API route escapes and oversized bodies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(LIMITS.logBytes + 1)));
    const api = githubReader("token", fetcher);
    for (const path of ["https://evil", "/repos/other/repo/pulls/1", `/repos/${REVIEW_POLICY.repository}/../secret`]) await expect(api.get(path)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled(); await expect(api.log(1)).rejects.toThrow();
  });
  it("pins trusted checkout and read permissions, without PR code, caches, installs or autonomous execution", () => {
    const yaml = readFileSync(new URL("../../.github/workflows/pr-review.yml", import.meta.url), "utf8");
    expect(yaml).toContain("workflow_run:"); expect(yaml).toContain("github.ref == 'refs/heads/main'");
    expect(yaml).toContain("ref: ${{ github.sha }}"); expect(yaml).toContain("persist-credentials: false");
    for (const scope of ["contents", "pull-requests", "issues", "actions"]) expect(yaml).toContain(`${scope}: read`);
    expect(yaml).not.toMatch(/:\s*write\b|pull_request_target|secrets\.|OPENAI_API_KEY|download-artifact|cache:|pnpm|npm |codex exec/);
    expect([...yaml.matchAll(/uses:\s+\S+@([^\s]+)/g)].every((m) => /^[a-f0-9]{40}$/.test(m[1]!))).toBe(true);
    const source = readFileSync(new URL("../pr-review-github.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/child_process|\beval\s*\(|new Function|method:\s*["'](?:POST|PATCH|DELETE|PUT)/);
  });
});
