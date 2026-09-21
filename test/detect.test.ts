// test/detect.test.ts — detectTestRunner (repo's package manager + test command)

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTestRunner } from "../src/detect.js";

function repoWith(
  name: string,
  pkg: Record<string, unknown> | null,
  lockfiles: string[],
): string {
  const dir = mkdtempSync(join(tmpdir(), `fapony-detect-${name}-`));
  if (pkg) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  for (const lf of lockfiles) {
    if (lf.endsWith("/")) {
      mkdirSync(join(dir, lf.replace(/\/$/, "")), { recursive: true });
    } else {
      writeFileSync(join(dir, lf), "");
    }
  }
  return dir;
}

export function testDetectBunViaPackageManager(): void {
  const dir = repoWith("bun-pm", { packageManager: "bun@1.2.0" }, []);
  try {
    const r = detectTestRunner(dir);
    assert.deepEqual(r, {
      runner: "bun",
      testCmd: "bun test",
      typecheckCmd: null,
      lockfile: "bun.lock",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect bun (packageManager field)");
}

export function testDetectBunViaPackageManagerWithTypecheckScript(): void {
  const dir = repoWith(
    "bun-tsc",
    { packageManager: "bun@1.2.0", scripts: { typecheck: "tsc --noEmit" } },
    [],
  );
  try {
    const r = detectTestRunner(dir);
    assert.equal(r?.typecheckCmd, "bun run typecheck");
    assert.equal(r?.testCmd, "bun test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect bun typecheck script → bun run typecheck");
}

export function testDetectNpmViaLockfile(): void {
  const dir = repoWith("npm", {}, ["package-lock.json"]);
  try {
    const r = detectTestRunner(dir);
    assert.deepEqual(r, {
      runner: "npm",
      testCmd: "npm test",
      typecheckCmd: null,
      lockfile: "package-lock.json",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect npm (package-lock.json)");
}

export function testDetectPnpmViaLockfile(): void {
  const dir = repoWith("pnpm", {}, ["pnpm-lock.yaml"]);
  try {
    const r = detectTestRunner(dir);
    assert.equal(r?.runner, "pnpm");
    assert.equal(r?.testCmd, "pnpm test");
    assert.equal(r?.lockfile, "pnpm-lock.yaml");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect pnpm (pnpm-lock.yaml)");
}

export function testDetectYarnViaLockfile(): void {
  const dir = repoWith("yarn", {}, ["yarn.lock"]);
  try {
    const r = detectTestRunner(dir);
    assert.equal(r?.runner, "yarn");
    assert.equal(r?.testCmd, "yarn test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect yarn (yarn.lock)");
}

export function testDetectNullWhenNoPackageJson(): void {
  const dir = mkdtempSync(join(tmpdir(), `fapony-detect-empty-`));
  try {
    assert.equal(detectTestRunner(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect null when no package.json");
}

export function testDetectNullWhenPackageJsonHasNoSignal(): void {
  // package.json exists but no packageManager field and no lockfile → foreign.
  const dir = repoWith("foreign", { name: "x" }, []);
  try {
    assert.equal(detectTestRunner(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect null when package.json has no runner signal");
}

export function testDetectSkipsUnrecognizedPackageManager(): void {
  const dir = repoWith("deno", { packageManager: "deno@2.0" }, []);
  try {
    assert.equal(detectTestRunner(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ detect null for unrecognized packageManager");
}
