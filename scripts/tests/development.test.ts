import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheMatches, checkArtifacts, checkToolchain, fingerprint, pnpmInvocation, preparationInputs, preparationOutputs } from "../development-support.ts";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "strategy-dev-"));
  temporaryRoots.push(root);
  const packages = [join(root, "database"), join(root, "packages/shared-types")];
  function write(path: string, contents = "fixture") {
    const fullPath = join(root, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, contents);
  }
  for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
    "database/package.json", "database/tsconfig.json", "database/src/index.ts", "database/prisma/schema.prisma",
    "database/src/generated/prisma/client.ts", "database/dist/index.js", "database/dist/generated/prisma/client.js",
    "database/dist/generated/prisma/internal/class.js", "packages/shared-types/package.json",
    "packages/shared-types/tsconfig.json", "packages/shared-types/src/index.ts", "packages/shared-types/dist/index.js"])
    write(path);
  return { root, packages, write };
}

describe("development preparation and preflight", () => {
  it("launches native and JS pnpm without shell parsing, preserving paths with spaces", () => {
    const args = ["--filter", "@strategy-game/server^...", "list"];
    expect(pnpmInvocation("C:/Tools with spaces/pnpm-native.exe", args)).toEqual({
      command: "C:/Tools with spaces/pnpm-native.exe", args
    });
    expect(pnpmInvocation("C:/Tools with spaces/pnpm.cjs", args)).toEqual({
      command: process.execPath, args: ["C:/Tools with spaces/pnpm.cjs", ...args]
    });
  });
  it.each(["22.13.0", "22.99.0", "24.0.0", "26.13.0"])("accepts supported Node %s and pinned pnpm", (version) => {
    expect(() => checkToolchain(version, "pnpm/12.18.0 npm/? node/v26.13.0", "pnpm@12.18.0")).not.toThrow();
  });
  it.each(["20.19.0", "22.12.0", "23.9.0"])("rejects unsupported Node %s with installation guidance", (version) => {
    expect(() => checkToolchain(version, "pnpm/12.18.0", "pnpm@12.18.0")).toThrow("Use Node.js");
  });
  it("requires the pinned pnpm rather than npm or a different pnpm", () => {
    for (const agent of ["", "npm/12.18.0", "pnpm/11.0.0"]) {
      expect(() => checkToolchain("24.0.0", agent, "pnpm@12.18.0")).toThrow("pnpm@12.18.0");
    }
  });
  it("invalidates preparation on source/config/lock changes but excludes secrets and generated source from inputs", () => {
    const { root, packages, write } = fixture();
    const inputs = () => fingerprint(root, preparationInputs(root, packages));
    const original = inputs();
    write(".env", "SECRET=never-cache-this");
    write("database/src/generated/prisma/client.ts", "regenerated");
    expect(inputs()).toBe(original);
    for (const path of ["packages/shared-types/src/index.ts", "pnpm-lock.yaml", "tsconfig.base.json", "database/prisma/schema.prisma"]) {
      const before = inputs();
      write(path, "changed");
      expect(inputs()).not.toBe(before);
    }
    write("packages/shared-types/src/new-file.ts");
    const added = inputs();
    rmSync(join(root, "packages/shared-types/src/new-file.ts"));
    expect(inputs()).not.toBe(added);
  });
  it("detects missing/tampered outputs including nested compiled Prisma files", () => {
    const { root, packages, write } = fixture();
    const inputs = fingerprint(root, preparationInputs(root, packages));
    const outputs = () => fingerprint(root, preparationOutputs(root, packages));
    const cache = { inputs, outputs: outputs() };
    expect(cacheMatches(cache, inputs, outputs())).toBe(true);
    rmSync(join(root, "database/dist/generated/prisma/internal/class.js"));
    expect(cacheMatches(cache, inputs, outputs())).toBe(false);
    write("database/dist/generated/prisma/internal/class.js");
    expect(cacheMatches(cache, inputs, outputs())).toBe(true);
    write("packages/shared-types/dist/index.js", "modified");
    expect(cacheMatches(cache, inputs, outputs())).toBe(false);
    expect(cacheMatches({}, inputs, outputs())).toBe(false);
  });
  it("reports missing generated/build entry points with a repair command", () => {
    const { root, packages } = fixture();
    expect(() => checkArtifacts(root, packages)).not.toThrow();
    rmSync(join(root, "database/src/generated/prisma/client.ts"));
    expect(() => checkArtifacts(root, packages)).toThrow("pnpm dev:prepare");
  });
});
