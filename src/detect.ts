// src/detect.ts — read a repo's package.json to detect its test runner.
//
// The Stop hook fires in every repo but used to hardcode fapony-specific
// commands in its block message (bug class: setup.ts, hook.ts). Now the message
// derives the command from the worktree at runtime — one source of truth, reused
// by the hook (decideStop) and by install (what it reports).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TestRunner = "bun" | "npm" | "pnpm" | "yarn";

export interface TestRunnerInfo {
  runner: TestRunner;
  testCmd: string;
  typecheckCmd: string | null;
  lockfile: string;
}

const RUNNER_LOCKFILE: Record<TestRunner, string> = {
  bun: "bun.lock",
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
};

const RUNNER_TEST_CMD: Record<TestRunner, string> = {
  bun: "bun test",
  npm: "npm test",
  pnpm: "pnpm test",
  yarn: "yarn test",
};

const RUNNER_TYPECHECK_CMD: Record<TestRunner, string> = {
  bun: "bun run typecheck",
  npm: "npm run typecheck",
  pnpm: "pnpm run typecheck",
  yarn: "yarn run typecheck",
};

/**
 * Detect a repo's test runner from its package.json + lockfile.
 * Returns null when the worktree has no package.json or no recognizable runner.
 *
 * Priority: `packageManager` field (explicit) → lockfile presence (fallback).
 * A repo with neither is foreign to us — the caller falls back to a generic
 * "this repo's test suite" message rather than guessing.
 */
export function detectTestRunner(worktree: string): TestRunnerInfo | null {
  const pkgPath = join(worktree, "package.json");
  if (!existsSync(pkgPath)) return null;

  let pkg: { packageManager?: string; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }

  const runner = detectRunner(worktree, pkg);
  if (!runner) return null;

  const scripts = pkg.scripts ?? {};
  const typecheckCmd =
    "typecheck" in scripts ? RUNNER_TYPECHECK_CMD[runner] : null;

  return {
    runner,
    testCmd: RUNNER_TEST_CMD[runner],
    typecheckCmd,
    lockfile: RUNNER_LOCKFILE[runner],
  };
}

function detectRunner(
  worktree: string,
  pkg: { packageManager?: string },
): TestRunner | null {
  const pm = pkg.packageManager;
  if (typeof pm === "string") {
    if (pm.startsWith("bun@")) return "bun";
    if (pm.startsWith("pnpm@")) return "pnpm";
    if (pm.startsWith("yarn@")) return "yarn";
    if (pm.startsWith("npm@")) return "npm";
  }
  if (existsSync(join(worktree, "bun.lock"))) return "bun";
  if (existsSync(join(worktree, "bun.lockb"))) return "bun";
  if (existsSync(join(worktree, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(worktree, "yarn.lock"))) return "yarn";
  if (existsSync(join(worktree, "package-lock.json"))) return "npm";
  return null;
}
