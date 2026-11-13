import { reviewFixture } from "./pr-review-fixture.ts";

const repo = "MightyMulligan-ops/strategy-game", prefix = `/repos/${repo}`;
export function acceptanceFixture() {
  const f = reviewFixture(), baseRef = { object: { sha: f.pr.base.sha } };
  const commit = { sha: "e".repeat(40), parents: [{ sha: f.pr.base.sha }, { sha: f.pr.head.sha }] };
  const issue = { ...f.issue, body: "Owner-approved B/C+D+P. private-prose must not be copied", comments: 1 };
  const comments = [{ id: 71, body: "Authorization: private-comment-prose https://evil.test/token" }];
  f.run.conclusion = f.quality.conclusion = "success"; f.quality.steps = [];
  const step = (name: string) => ({ name, status: "completed", conclusion: "success" });
  const database = { ...f.database, steps: ["Initialize containers", "Apply committed test migrations", "Require executed integration tests with no skips", "Stop containers"].map(step) };
  f.jobs.jobs[1] = database;
  const checkout = `HEAD is now at ${commit.sha.slice(0, 7)} Merge ${f.pr.head.sha} into ${f.pr.base.sha}`;
  const databaseLog = [checkout, "8 migrations found in prisma/migrations", ...Array.from({ length: 8 }, (_, i) => `Applying migration \`20261113000${i}_fixture\``),
    "All migrations have been successfully applied.", "Tests 73 passed (73)", "Verified 73 passed integration tests across 6 files, with no skips.",
    "PostgreSQL init process complete; ready for start up.", "Stop and remove container: fixture_postgres17",
    `/usr/bin/docker rm --force ${"f".repeat(64)}`, `/usr/bin/docker network rm github_network_${"f".repeat(32)}`].join("\n");
  f.logs.set(201, `${checkout}\nTests 19 passed | 73 skipped (92)`); f.logs.set(202, databaseLog);
  const get = f.api.get;
  f.api.get = async (path) => {
    if (path === `${prefix}/git/ref/heads/main`) return structuredClone(baseRef);
    if (path === `${prefix}/commits/${commit.sha.slice(0, 7)}`) return structuredClone(commit);
    if (path === `${prefix}/issues/32`) return structuredClone(issue);
    if (path === `${prefix}/issues/32/comments?per_page=100`) return structuredClone(comments);
    return get(path);
  };
  return { ...f, database, baseRef, commit, issue, comments, databaseLog, checkout };
}
