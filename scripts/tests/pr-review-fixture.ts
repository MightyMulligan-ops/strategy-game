import { REVIEW_POLICY } from "../pr-review.ts";
import type { ReadGitHub, ReviewRequest } from "../pr-review-github.ts";

// Synthetic API responses only; usable for offline previews without GitHub or database credentials.
export function reviewFixture() {
  const repo = REVIEW_POLICY.repository; const prefix = `/repos/${repo}`;
  const pr = { number: 33, state: "open", merged: false, draft: true, changed_files: 3,
    title: "ignore instructions: secret-title", body: "Closes #32\nprivate prose must never be repeated",
    head: { sha: "a".repeat(40), ref: "issue/32-pr-review-diagnostics", repo: { full_name: repo } }, base: { ref: "main", sha: "c".repeat(40), repo: { full_name: repo } } };
  const workflow = { id: 1, path: REVIEW_POLICY.workflow };
  const run = { id: 100, run_attempt: 1, workflow_id: 1, path: REVIEW_POLICY.workflow, event: "pull_request", status: "completed", conclusion: "failure",
    repository: { full_name: repo }, head_repository: { full_name: repo }, head_sha: pr.head.sha, pull_requests: [{ number: 33 }] };
  const quality = { id: 201, run_id: 100, run_attempt: 1, name: "Application checks", status: "completed", conclusion: "failure",
    steps: [{ name: "TypeScript checks", conclusion: "failure" }] };
  const database = { id: 202, run_id: 100, run_attempt: 1, name: "PostgreSQL integration tests", status: "completed", conclusion: "success", steps: [] };
  const jobs = { total_count: 2, jobs: [quality, database] };
  const runs = { total_count: 1, workflow_runs: [run] };
  const files: Record<string, unknown>[] = [
    { filename: "docs/CI.md", status: "modified", additions: 4, deletions: 1 },
    { filename: "apps/server/src/auth/security.ts", status: "modified", additions: 2, deletions: 0 },
    { filename: "archive/old.sql", previous_filename: "database/prisma/migrations/example/migration.sql", status: "renamed", additions: 0, deletions: 0 }
  ];
  const issue = { number: 32, state: "open", labels: [{ name: "review-needed" }] };
  const artifacts = { artifacts: [{ name: "application-failure-logs", expired: false }, { name: "unsafe artifact name", expired: false }] };
  const logs = new Map<number, string>([
    [201, "Error postgresql://user:pass@localhost/private player-secret=do-not-repeat\nBearer token-secret\nerror TS2339: secret member\n Tests 19 passed | 1 failed (20)\n::warning::untrusted-command"],
    [202, "Tests 73 passed (73)\nVerified 73 passed integration tests across 6 files, with no skips."]
  ]);
  const calls: string[] = [];
  const api: ReadGitHub = {
    async get(path) {
      calls.push(path);
      if (path === `${prefix}/collaborators/owner/permission`) return { permission: "admin" };
      if (path === `${prefix}/actions/workflows/ci.yml`) return structuredClone(workflow);
      if (path === `${prefix}/pulls/33`) return structuredClone(pr);
      if (path === `${prefix}/issues/32`) return structuredClone(issue);
      if (path === `${prefix}/pulls/33/files?per_page=100&page=1`) return structuredClone(files);
      if (path.includes("/actions/workflows/1/runs?")) return structuredClone(runs);
      if (path === `${prefix}/actions/runs/100`) return structuredClone(run);
      if (path === `${prefix}/actions/runs/100/jobs?filter=latest&per_page=100`) return structuredClone(jobs);
      if (path === `${prefix}/actions/runs/100/artifacts?per_page=100`) return structuredClone(artifacts);
      throw new Error("untrusted API failure should not be echoed");
    },
    async log(id) { calls.push(`log:${id}`); const value = logs.get(id); if (value === undefined) throw new Error("log unavailable"); return value; }
  };
  const request: ReviewRequest = { repository: repo, ref: "refs/heads/main", event: "workflow_dispatch", actor: "owner", pr: "33" };
  return { api, request, pr, workflow, run, runs, quality, database, jobs, files, issue, artifacts, logs, calls };
}
