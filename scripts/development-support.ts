import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export function pnpmInvocation(cli: string, args: string[]): { command: string; args: string[] } {
  return /\.(?:cjs|mjs|js)$/i.test(cli)
    ? { command: process.execPath, args: [cli, ...args] }
    : { command: cli, args };
}

export function checkToolchain(nodeVersion: string, userAgent: string, packageManager: string): void {
  const [major = 0, minor = 0] = nodeVersion.replace(/^v/, "").split(".").map(Number);
  if (!((major === 22 && minor >= 13) || major >= 24)) {
    throw new Error("Use Node.js 22.13+ on the 22.x line, or Node.js 24+. Restart your terminal after installing Node.");
  }
  const expected = packageManager.replace("pnpm@", "");
  if (userAgent.match(/(?:^|\s)pnpm\/([^\s]+)/)?.[1] !== expected) {
    throw new Error(`Use pnpm ${expected}, as pinned in package.json. Install it with npm install --global pnpm@${expected}, then run pnpm dev:prepare.`);
  }
}

function filesIn(directory: string, skipGenerated = false): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (skipGenerated && entry.name === "generated") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path, skipGenerated) : entry.isFile() ? [path] : [];
  });
}

export function fingerprint(root: string, paths: readonly string[], salt = ""): string {
  const hash = createHash("sha256").update(salt);
  for (const path of [...paths].sort()) {
    hash.update(JSON.stringify(relative(root, path).replaceAll("\\", "/")));
    hash.update(existsSync(path) ? readFileSync(path) : "<missing>");
  }
  return hash.digest("hex");
}

export function preparationInputs(root: string, packages: readonly string[]): string[] {
  return [
    ...["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
      "scripts/development.ts", "scripts/development-support.ts", "database/prisma.config.ts"].map((path) => join(root, path)),
    ...packages.flatMap((directory) => [join(directory, "package.json"), join(directory, "tsconfig.json"),
      ...filesIn(join(directory, "src"), true), ...filesIn(join(directory, "prisma"))])
  ];
}

export function preparationOutputs(root: string, packages: readonly string[]): string[] {
  return [
    ...packages.flatMap((directory) => filesIn(join(directory, "dist"))),
    // Generated source is ignored in ordinary source traversal, but its entire
    // tree is included here so deletions/edits invalidate the preparation cache.
    ...filesIn(join(root, "database/src/generated/prisma"))
  ];
}

export function checkArtifacts(root: string, packages: readonly string[]): void {
  const required = [join(root, "database/src/generated/prisma/client.ts"),
    join(root, "database/dist/generated/prisma/client.js"),
    ...packages.map((directory) => join(directory, "dist/index.js"))];
  if (required.some((path) => !existsSync(path))) {
    throw new Error("Workspace build output or Prisma Client is missing. Run pnpm dev:prepare (or pnpm dev:prepare --force to rebuild).");
  }
}

export function cacheMatches(cache: unknown, inputs: string, outputs: string): boolean {
  return typeof cache === "object" && cache !== null && "inputs" in cache && "outputs" in cache &&
    cache.inputs === inputs && cache.outputs === outputs;
}
