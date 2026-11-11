import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Exercise the exact inline script used by the privileged workflow. There is
// no second implementation and no dependency/checkout in the production job.
const workflow = readFileSync(new URL("../../.github/workflows/issue-status.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const block = workflow.split("          script: |\n")[1];
if (!block) throw new Error("Workflow script block missing");
const source = block.split("\n").map((line) => line.startsWith("            ") ? line.slice(12) : line).join("\n");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) =>
  (github: unknown, context: unknown, core: unknown) => Promise<void>;
const execute = new AsyncFunction("github", "context", "core", source);

function fixture() {
  const repository = "MightyMulligan-ops/strategy-game";
  const issue = { number: 2, state: "open", labels: [{ name: "in-progress" }, { name: "enhancement" }], pull_request: undefined as object | undefined };
  const pr = { number: 5, state: "open", body: "Closes #2", draft: true,
    head: { ref: "issue/2-sample", repo: { full_name: repository } },
    base: { ref: "main", repo: { full_name: repository } } };
  const context = { repo: { owner: "MightyMulligan-ops", repo: "strategy-game" }, ref: "refs/heads/main",
    actor: "owner", eventName: "pull_request_target", payload: {
      action: "opened", pull_request: { number: 5 }, issue: { number: 2, pull_request: undefined as object | undefined },
      label: { name: "in-progress" }, changes: { body: { from: "Closes #2" } }, inputs: { issue_number: "" }
    } };
  const events = [{ event: "labeled", label: { name: "in-progress" }, actor: { login: "owner" } }];
  const openPRs = [pr];
  const repos = { getCollaboratorPermissionLevel: vi.fn(async ({ username }: { username: string }) => ({
    data: { permission: username === "owner" ? "admin" : username === "triager" ? "triage" : "read" }
  })) };
  const issues = {
    get: vi.fn(async () => ({ data: issue })),
    getLabel: vi.fn(async () => { throw Object.assign(new Error("Not found"), { status: 404 }); }),
    createLabel: vi.fn(async () => ({})), updateLabel: vi.fn(async () => ({})),
    addLabels: vi.fn(async ({ labels }: { labels: string[] }) => {
      issue.labels.push(...labels.map((name) => ({ name }))); return {};
    }),
    removeLabel: vi.fn(async ({ name }: { name: string }) => {
      issue.labels = issue.labels.filter((label) => label.name !== name); return {};
    }),
    listEvents: vi.fn()
  };
  const pulls = { get: vi.fn(async () => ({ data: pr })), list: vi.fn() };
  const github = { rest: { repos, issues, pulls }, paginate: vi.fn(async (method: unknown) => method === issues.listEvents ? events : openPRs) };
  const core = { info: vi.fn(), warning: vi.fn(), setFailed: vi.fn() };
  const run = () => execute(github, context, core);
  const statuses = () => issue.labels.map((label) => label.name);
  return { github, context, core, issue, pr, events, openPRs, repos, issues, pulls, run, statuses };
}

describe("issue metadata workflow security", () => {
  it("has no checkout, shell, package install, remote Codex, key, or untrusted expression interpolation", () => {
    expect(workflow).toContain("permissions: {}");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).not.toMatch(/(?:contents|pull-requests|actions): write/);
    expect(workflow).not.toMatch(/^\s*(?:run|schedule):/m);
    expect(workflow).not.toMatch(/uses:.*(?:checkout|setup-node|codex|pnpm)/i);
    expect(workflow).not.toMatch(/OPENAI_API_KEY|secrets\.|codex exec|api\.openai/i);
    expect(source).not.toContain("${{");
    expect(source).not.toMatch(/\b(?:eval|require|import|fetch)\s*\(|\bnew Function\b/);
  });
  it.each(["outsider", "triager"])("rejects %s before any metadata mutation", async (actor) => {
    const f = fixture(); f.context.actor = actor;
    await f.run();
    expect(f.issues.createLabel).not.toHaveBeenCalled();
    expect(f.issues.addLabels).not.toHaveBeenCalled();
    expect(f.issues.removeLabel).not.toHaveBeenCalled();
  });
  it("fails closed on permission lookup errors", async () => {
    const f = fixture(); f.repos.getCollaboratorPermissionLevel.mockRejectedValue(new Error("Unavailable"));
    await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
  });
  it.each(["fork", "base", "branch", "repository", "ref"])("rejects invalid %s scope", async (kind) => {
    const f = fixture();
    if (kind === "fork") f.pr.head.repo.full_name = "outsider/strategy-game";
    if (kind === "base") f.pr.base.ref = "other";
    if (kind === "branch") f.pr.head.ref = "issue/99-sample";
    if (kind === "repository") f.context.repo.repo = "other";
    if (kind === "ref") f.context.ref = "refs/heads/untrusted";
    await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
    expect(f.issues.removeLabel).not.toHaveBeenCalled();
  });
  it.each(["Closes other/repository#2", "Closes https://github.com/other/repository/issues/2", "Closes #2\nCloses #3",
    "Closes #2\nThis also fixes other/repository#9", "Closes #3", "Closes #2; shell-command", "<!-- Closes #2 -->",
    "```sh\nCloses #2\n```", "Closes #9007199254740992"])("rejects ambiguous or invalid reference %s", async (body) => {
    const f = fixture(); f.pr.body = body;
    await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
    expect(f.issues.removeLabel).not.toHaveBeenCalled();
  });
  it("does not trust issue text, current labels, or author association as approval", async () => {
    const f = fixture(); f.events[0]!.actor.login = "triager";
    await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
    f.events[0]!.actor.login = "github-actions[bot]";
    f.issue.labels = [{ name: "agent-ready" }]; f.events[0]!.label.name = "agent-ready";
    await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
  });
  it("ignores unapproved issues and references that are actually PRs", async () => {
    const f = fixture(); f.issue.labels = [{ name: "bug" }];
    await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
    f.issue.pull_request = {}; await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
  });
  it("re-fetches PR metadata rather than trusting a stale event's body/head", async () => {
    const f = fixture(); f.pr.body = "Unrelated work";
    await f.run(); expect(f.pulls.get).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 5 }));
    expect(f.issues.addLabels).not.toHaveBeenCalled();
  });
});

describe("issue metadata transitions", () => {
  it("moves approved work to review-needed for a matching draft PR and preserves unrelated labels", async () => {
    const f = fixture(); await f.run();
    expect(f.statuses()).toEqual(["enhancement", "review-needed"]);
    expect(f.issues.createLabel).toHaveBeenCalledTimes(4);
  });
  it("preserves blocked status during PR updates", async () => {
    const f = fixture(); f.issue.labels.push({ name: "blocked" });
    await f.run(); expect(f.issues.addLabels).not.toHaveBeenCalled();
    expect(f.issues.removeLabel).not.toHaveBeenCalled();
  });
  it("does not assign another status when duplicate valid PRs are open", async () => {
    const f = fixture(); f.openPRs.push({ ...f.pr, number: 6 });
    await f.run(); expect(f.core.warning).toHaveBeenCalled();
    expect(f.issues.addLabels).not.toHaveBeenCalled();
  });
  it.each(["closed", "edited"])("returns work to in-progress after the last valid PR is %s/unlinked", async (action) => {
    const f = fixture(); f.context.payload.action = action;
    f.issue.labels = [{ name: "review-needed" }]; f.events[0]!.label.name = "review-needed";
    f.events[0]!.actor.login = "github-actions[bot]"; f.openPRs.length = 0;
    if (action === "edited") f.pr.body = "Link removed";
    else f.pr.state = "closed";
    await f.run(); expect(f.statuses()).toEqual(["in-progress"]);
  });
  it("clears managed labels from closed issues without closing/reopening anything", async () => {
    const f = fixture(); f.context.eventName = "issues"; f.issue.state = "closed";
    f.issue.labels.push({ name: "blocked" });
    await f.run(); expect(f.statuses()).toEqual(["enhancement"]);
    expect(f.issues.addLabels).not.toHaveBeenCalled();
  });
  it("lets a maintainer explicitly change blocked status but ignores stale label events", async () => {
    const f = fixture(); f.context.eventName = "issues"; f.context.payload.action = "labeled";
    f.issue.labels.push({ name: "blocked" }); f.openPRs.length = 0;
    f.events[0]!.actor.login = "triager";
    await f.run(); expect(f.statuses()).toContain("blocked");
    f.events[0]!.actor.login = "owner";
    await f.run(); expect(f.statuses()).toEqual(["in-progress", "enhancement"]);
  });
  it("does not let an older status event undo a newer status by the same maintainer", async () => {
    const f = fixture(); f.context.eventName = "issues"; f.context.payload.action = "labeled";
    f.issue.labels.push({ name: "blocked" }); f.openPRs.length = 0;
    f.events.push({ event: "labeled", label: { name: "blocked" }, actor: { login: "owner" } });
    await f.run(); expect(f.statuses()).toContain("blocked");
    expect(f.issues.removeLabel).not.toHaveBeenCalled();
  });
  it("provisions only labels on an empty manual dispatch and validates numeric inputs", async () => {
    const f = fixture(); f.context.eventName = "workflow_dispatch";
    await f.run(); expect(f.issues.createLabel).toHaveBeenCalledTimes(4);
    expect(f.issues.addLabels).not.toHaveBeenCalled();
    f.context.payload.inputs.issue_number = "2; unsafe";
    await f.run(); expect(f.core.setFailed).toHaveBeenCalled();
    expect(f.issues.createLabel).toHaveBeenCalledTimes(4);
  });
});
