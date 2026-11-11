import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readAuthConfig } from "../apps/server/src/auth/config.ts";
import { cacheMatches, checkArtifacts, checkToolchain, fingerprint, pnpmInvocation, preparationInputs, preparationOutputs } from "./development-support.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const filters = ["--filter", "@strategy-game/server^...", "--filter", "@strategy-game/web^..."];
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { packageManager: string };

function pnpm(args: string[], capture = false): string {
  // pnpm supplies either a JS entry point or its native executable. Avoid .cmd
  // shell quoting while supporting both installation styles on Windows.
  const cli = process.env.npm_execpath;
  if (!cli || !existsSync(cli)) throw new Error("Run this workflow through pnpm dev, pnpm dev:prepare, or pnpm dev:check.");
  const invocation = pnpmInvocation(cli, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root, stdio: capture ? "pipe" : "inherit", encoding: "utf8"
  });
  if (result.error || result.status !== 0) throw new Error(`pnpm ${args.join(" ")} did not complete. ${capture ? "Run pnpm install --frozen-lockfile and retry." : "Check the command output above and retry."}`);
  return result.stdout ?? "";
}

function workspacePackages(): string[] {
  const list = JSON.parse(pnpm([...filters, "list", "--depth", "-1", "--json"], true)) as { path: string }[];
  if (list.length === 0) throw new Error("No workspace dependencies found. Run pnpm install --frozen-lockfile from the repository root.");
  return list.map((entry) => entry.path);
}

function prepare(packages: string[]): void {
  const cacheFile = join(root, ".cache/dev-preparation.json");
  const inputs = fingerprint(root, preparationInputs(root, packages), `${process.version}:${manifest.packageManager}`);
  const outputs = fingerprint(root, preparationOutputs(root, packages));
  let cache: unknown;
  try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { /* A missing/corrupt cache requires preparation. */ }
  if (!process.argv.includes("--force") && cacheMatches(cache, inputs, outputs)) {
    checkArtifacts(root, packages);
    console.log("[dev] Workspace dependencies and Prisma Client are up to date.");
    return;
  }
  console.log("[dev] Building workspace dependencies in pnpm dependency order (including Prisma generation)…");
  pnpm([...filters, "run", "build"]);
  checkArtifacts(root, packages);
  mkdirSync(join(root, ".cache"), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ inputs, outputs: fingerprint(root, preparationOutputs(root, packages)) }));
}

async function preflight(packages: string[]): Promise<void> {
  checkArtifacts(root, packages);
  let database: { createDatabaseClient(): {
    $queryRawUnsafe(query: string): Promise<unknown>; $disconnect(): Promise<void>;
  } };
  try {
    // Importing verifies compiled/transitive generated modules without opening
    // a connection. The current backend imports this package even with auth off.
    database = await import(pathToFileURL(join(root, "database/dist/index.js")).href);
  } catch {
    throw new Error("Workspace or Prisma runtime output is incomplete. Run pnpm dev:prepare --force.");
  }
  const envFile = join(root, ".env");
  if (existsSync(envFile)) {
    try { loadEnvFile(envFile); } catch { throw new Error("Unable to load the root .env. Check its syntax against .env.example."); }
  }
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  if (port !== 3001) console.log("[dev] PORT is overridden. Ensure apps/web/vite.config.ts proxies /auth to that backend port.");
  // Reuse the backend validator; this does not change authentication defaults or policy.
  const config = readAuthConfig(process.env);
  if (!config) {
    console.log("[dev] Authentication is disabled; the current backend does not require PostgreSQL.");
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("AUTH_ENABLED=true requires DATABASE_URL. Configure the root .env using .env.example.");
  try {
    const client = database.createDatabaseClient();
    try {
      await client.$queryRawUnsafe("SELECT 1");
    } finally {
      await client.$disconnect();
    }
  } catch {
    // Database/driver errors can contain URLs and credentials. Never echo them.
    throw new Error("PostgreSQL is unavailable. Check the selected DATABASE_URL and service readiness privately. Do not switch database targets or apply migrations without separate owner approval.");
  }
  console.log("[dev] Authentication configuration and PostgreSQL connection checked. Use pnpm db:status to check migrations.");
}

try {
  checkToolchain(process.version, process.env.npm_config_user_agent ?? "", manifest.packageManager);
  const mode = process.argv[2];
  if (!["start", "prepare", "check"].includes(mode ?? "")) throw new Error("Use pnpm dev, pnpm dev:prepare, or pnpm dev:check.");
  const packages = workspacePackages();
  if (mode !== "check") prepare(packages);
  if (mode !== "prepare") await preflight(packages);
  if (mode === "start") {
    console.log("[dev] Starting Vite and Fastify. Press Ctrl+C to stop both. After shared-package edits, stop and rerun pnpm dev.");
    pnpm(["--parallel", "--filter", "@strategy-game/web", "--filter", "@strategy-game/server", "run", "dev"]);
  }
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : "Development startup failed. Run pnpm dev:prepare and pnpm dev:check."}`);
  process.exitCode = 1;
}
