import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  REVIEW_POLICY, LIMITS, object, list, positive, sha, conclusion, linkedIssue, protectedFlags, displayPath, safeStep, logFacts,
  renderReview, renderHandoff
} from "./pr-review.ts";
import type { Json, ReviewReport } from "./pr-review.ts";

export interface ReadGitHub { get(path: string): Promise<unknown>; log(jobId: number): Promise<string> }
export type ReviewRequest = { repository: string; ref: string; event: string; actor: string; pr?: unknown; run?: unknown };
const repoPath = `/repos/${REVIEW_POLICY.repository}`;
const managed = new Set(["agent-ready", "in-progress", "review-needed", "blocked"]);
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000_000) throw new Error("Invalid count");
  return value as number;
}
function validPR(value: unknown, number: number): Json {
  const pr = object(value); const base = object(pr.base);
  if (pr.number !== number || object(base.repo).full_name !== REVIEW_POLICY.repository || base.ref !== REVIEW_POLICY.base ||
      !["open", "closed"].includes(String(pr.state)) || typeof pr.merged !== "boolean" || typeof pr.draft !== "boolean") throw new Error("PR scope unavailable");
  sha(object(pr.head).sha); sha(base.sha); return pr;
}
function eligibleRun(value: unknown, workflowId: number, pr: Json): boolean {
  const run = object(value); const head = object(pr.head);
  return run.workflow_id === workflowId && run.path === REVIEW_POLICY.workflow && run.event === "pull_request" &&
    object(run.repository).full_name === REVIEW_POLICY.repository && run.head_sha === head.sha &&
    object(run.head_repository).full_name === object(head.repo).full_name &&
    list(run.pull_requests).some((p) => object(p).number === pr.number);
}

export async function collectReview(api: ReadGitHub, request: ReviewRequest): Promise<ReviewReport> {
  if (request.repository !== REVIEW_POLICY.repository || request.ref !== "refs/heads/main") throw new Error("Review scope rejected");
  if (!["workflow_dispatch", "workflow_run"].includes(request.event)) throw new Error("Review event rejected");
  if (request.event === "workflow_dispatch") {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(request.actor)) throw new Error("Actor rejected");
    const permission = object(await api.get(`${repoPath}/collaborators/${request.actor}/permission`));
    if (!["admin", "maintain", "write"].includes(String(permission.permission))) throw new Error("Maintainer dispatch required");
  }
  const workflow = object(await api.get(`${repoPath}/actions/workflows/ci.yml`));
  if (workflow.path !== REVIEW_POLICY.workflow) throw new Error("Unexpected CI workflow");
  const workflowId = positive(workflow.id);
  let number: number; let trigger: Json | undefined;
  if (request.event === "workflow_dispatch") {
    if (typeof request.pr !== "string" || !/^[1-9]\d*$/.test(request.pr)) throw new Error("PR number rejected");
    number = positive(Number(request.pr));
  } else {
    trigger = object(await api.get(`${repoPath}/actions/runs/${positive(request.run)}`));
    if (trigger.workflow_id !== workflowId || trigger.path !== REVIEW_POLICY.workflow || trigger.event !== "pull_request" ||
        trigger.status !== "completed" || object(trigger.repository).full_name !== REVIEW_POLICY.repository || list(trigger.pull_requests).length !== 1) throw new Error("CI trigger scope rejected");
    number = positive(object(list(trigger.pull_requests)[0]).number);
  }
  const pr = validPR(await api.get(`${repoPath}/pulls/${number}`), number);
  const head = sha(object(pr.head).sha); const base = sha(object(pr.base).sha); const notes: string[] = [];
  const fork = object(object(pr.head).repo).full_name !== REVIEW_POLICY.repository;
  const report: ReviewReport = { number, head, base, fork,
    state: pr.merged ? "merged" : pr.state === "closed" ? "closed/unmerged" : pr.draft ? "draft/unmerged" : "open/unmerged",
    issue: null, files: [], fileCount: count(pr.changed_files), filesComplete: false, flags: [], ci: null, notes };
  if (trigger && trigger.head_sha !== head) notes.push("Trigger run is obsolete; this report uses only the current PR head.");
  const issueNumber = fork ? null : linkedIssue(object(pr.head).ref, pr.body);
  if (issueNumber !== null) {
    try {
      const issue = object(await api.get(`${repoPath}/issues/${issueNumber}`));
      if (issue.number === issueNumber && !issue.pull_request && ["open", "closed"].includes(String(issue.state))) report.issue = {
        number: issueNumber, state: String(issue.state), labels: list(issue.labels).map((v) => object(v).name).filter((v): v is string => typeof v === "string" && managed.has(v)).sort()
      };
    } catch { notes.push("Linked issue metadata unavailable; no issue state was inferred."); }
  }
  const flags = new Set<string>();
  const seenPaths = new Set<string>();
  for (let page = 1; page <= LIMITS.files / 100; page++) {
    const files = list(await api.get(`${repoPath}/pulls/${number}/files?per_page=100&page=${page}`));
    if (files.length > 100) throw new Error("File page exceeds limit");
    for (const value of files) {
      const file = object(value);
      if (typeof file.filename !== "string" || seenPaths.has(file.filename)) throw new Error("Invalid file inventory");
      seenPaths.add(file.filename);
      for (const path of [file.filename, file.previous_filename]) {
        if (typeof path === "string") protectedFlags(path).forEach((flag) => flags.add(flag));
        else if (path === file.filename) flags.add("Unusual path: manual inspection");
      }
      report.files.push({ path: displayPath(file.filename), previous: typeof file.previous_filename === "string" ? displayPath(file.previous_filename) : null,
        status: ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"].includes(String(file.status)) ? String(file.status) : "unknown",
        additions: count(file.additions), deletions: count(file.deletions) });
    }
    if (files.length < 100) { report.filesComplete = report.files.length === report.fileCount; break; }
  }
  report.filesComplete = report.files.length === report.fileCount && report.fileCount <= LIMITS.files;
  report.flags = [...flags].sort();
  const runs = object(await api.get(`${repoPath}/actions/workflows/${workflowId}/runs?event=pull_request&head_sha=${head}&per_page=100`));
  const matching = list(runs.workflow_runs).filter((r) => eligibleRun(r, workflowId, pr)).map(object)
    .sort((a, b) => positive(b.id) - positive(a.id));
  if (count(runs.total_count) > 100) notes.push("CI discovery limited to the newest 100 runs; older evidence was not searched.");
  if (matching[0]) {
    const run = object(await api.get(`${repoPath}/actions/runs/${positive(matching[0].id)}`));
    if (run.id !== matching[0].id || !eligibleRun(run, workflowId, pr)) throw new Error("CI changed scope");
    const id = positive(run.id); const attempt = positive(run.run_attempt);
    const jobs = object(await api.get(`${repoPath}/actions/runs/${id}/jobs?filter=latest&per_page=100`));
    const values = list(jobs.jobs).map(object);
    if (values.length > 100) throw new Error("Too many jobs");
    if (count(jobs.total_count) !== values.length) notes.push("CI job inventory incomplete; missing checks must be reviewed manually.");
    report.ci = { id, attempt, conclusion: run.status === "completed" ? conclusion(run.conclusion) : "unknown/pending", jobs: [], artifacts: [] };
    for (const name of REVIEW_POLICY.jobs) {
      const selected = values.filter((job) => job.name === name);
      if (selected.length !== 1) { notes.push(`Required job ${name} missing/ambiguous; no test evidence inferred.`); continue; }
      const job = selected[0]!;
      if (job.run_id !== id || job.run_attempt !== attempt) throw new Error("Job attempt mismatch");
      const fact = { id: positive(job.id), name, conclusion: job.status === "completed" ? conclusion(job.conclusion) : "unknown/pending",
        failedSteps: list(job.steps ?? []).map(object).filter((s) => ["failure", "timed_out"].includes(String(s.conclusion))).map((s) => safeStep(s.name)).slice(0, 15),
        tests: null as ReturnType<typeof logFacts>["tests"], signals: [] as string[] };
      if (job.status === "completed") {
        try { Object.assign(fact, logFacts(await api.log(fact.id))); }
        catch { fact.signals.push("Logs unavailable, expired or over limit; inspect the job link"); }
      }
      report.ci.jobs.push(fact);
    }
    try {
      const artifacts = object(await api.get(`${repoPath}/actions/runs/${id}/artifacts?per_page=100`));
      report.ci.artifacts = list(artifacts.artifacts).map(object).filter((a) => a.expired === false &&
        ["application-failure-logs", "database-failure-logs"].includes(String(a.name))).map((a) => String(a.name)).filter((v, i, all) => all.indexOf(v) === i).sort();
    } catch { notes.push("Failure artifact inventory unavailable; use the CI run link."); }
    const finalRun = object(await api.get(`${repoPath}/actions/runs/${id}`));
    if (finalRun.id !== id || !eligibleRun(finalRun, workflowId, pr) || finalRun.run_attempt !== attempt || finalRun.status !== run.status || finalRun.conclusion !== run.conclusion) throw new Error("CI changed during report");
  }
  const finalPR = validPR(await api.get(`${repoPath}/pulls/${number}`), number);
  if (object(finalPR.head).sha !== head || object(finalPR.base).sha !== base || finalPR.state !== pr.state || finalPR.merged !== pr.merged || finalPR.draft !== pr.draft) throw new Error("PR changed during report");
  return report;
}

async function bounded(response: Response, maximum: number): Promise<string> {
  if (!response.ok || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("Response unavailable");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > maximum) throw new Error("Response too large"); chunks.push(next.value); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
export function githubReader(token: string, fetcher: typeof fetch = fetch): ReadGitHub {
  if (!token) throw new Error("GitHub authentication required");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const request = (url: string, authenticated: boolean) => fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), ...(authenticated ? { headers } : {}) });
  return {
    async get(path) {
      if (!path.startsWith(`${repoPath}/`) || /[^A-Za-z0-9_./?=&-]/.test(path) || path.includes("..")) throw new Error("API route rejected");
      return JSON.parse(await bounded(await request(`https://api.github.com${path}`, true), LIMITS.apiBytes)) as unknown;
    },
    async log(jobId) {
      const response = await request(`https://api.github.com${repoPath}/actions/jobs/${positive(jobId)}/logs`, true);
      if (response.status === 200) return bounded(response, LIMITS.logBytes);
      if (response.status !== 302) throw new Error("Log unavailable");
      const location = new URL(response.headers.get("location") ?? "");
      if (location.protocol !== "https:" || location.username || location.password || location.port ||
          !/(?:^|\.)(?:githubusercontent\.com|blob\.core\.windows\.net|github\.com)$/.test(location.hostname)) throw new Error("Log redirect rejected");
      // Signed storage URLs are never recorded and never receive the API token.
      return bounded(await request(location.href, false), LIMITS.logBytes);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const eventFile = process.env.GITHUB_EVENT_PATH;
    if (!eventFile) throw new Error("Missing event");
    const eventText = readFileSync(eventFile, "utf8"); if (Buffer.byteLength(eventText) > 1_048_576) throw new Error("Event too large");
    const event = object(JSON.parse(eventText));
    const report = await collectReview(githubReader(process.env.GITHUB_TOKEN ?? ""), {
      repository: process.env.GITHUB_REPOSITORY ?? "", ref: process.env.GITHUB_REF ?? "", event: process.env.GITHUB_EVENT_NAME ?? "",
      actor: process.env.GITHUB_ACTOR ?? "", pr: event.inputs ? object(event.inputs).pr_number : undefined,
      run: event.workflow_run ? object(event.workflow_run).id : undefined
    });
    const markdown = renderReview(report); mkdirSync(".cache/pr-review", { recursive: true });
    writeFileSync(".cache/pr-review/report.md", markdown); writeFileSync(".cache/pr-review/handoff.md", renderHandoff(report));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log("Read-only PR summary generated. No repository writes or repair execution.");
  } catch {
    const message = "PR summary unavailable: scope, authorization, API data or evidence changed/failed. No repair was started. Inspect trusted workflow configuration and rerun manually after verification.\n";
    // Replace a previous local preview instead of leaving an apparently current success.
    try {
      mkdirSync(".cache/pr-review", { recursive: true }); writeFileSync(".cache/pr-review/report.md", message);
      writeFileSync(".cache/pr-review/handoff.md", "No valid current report. Verify evidence manually; no repair is authorized.\n");
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
    } catch { /* File failures must not echo raw parser/API errors either. */ }
    console.error(message.trim());
    process.exitCode = 1;
  }
}
