// src/memory.ts — memory domain: config.memory.* shell adapter helpers.
// The shared mem-log reader now lives in src/core/mem-log.ts (PLAN-lib-layer chunk 2b).

import { execSync } from "node:child_process";
import type { Config } from "./core/config.js";
import { assertSafe } from "./safety.js";
import { templateArgs } from "./util.js";

// Re-export mem-log reader for existing callers (gate, hook, digest, mcp, seed, mem).
export {
  type MemDirResult,
  type MemRow,
  readMemLog,
  readRecentMemDecisions,
  resolveMemDir,
  whereMemDir,
} from "./core/mem-log.js";

// Internal import used by resolveMemoryConfig below.
import {
  resolveMemDir as _resolveMemDir,
  walkUpForMemDir,
} from "./core/mem-log.js";

/** Default memory commands — built into fapony via `fapony mem <sub>`. */
export const DEFAULT_MEMORY: Config["memory"] = {
  claim: ["fapony", "mem", "claim", "{id}"],
  close: ["fapony", "mem", "close", "{id}", "{msg}"],
  add: ["fapony", "mem", "add", "{kind}", "{text}"],
  kickoff: ["fapony", "mem", "kickoff"],
};

/**
 * Returns the effective memory config:
 * - explicit config.memory wins if set
 * - fallback: a mem log dir exists (any `.fapony/.memory/`) → DEFAULT_MEMORY
 * - otherwise null (no memory)
 */
export function resolveMemoryConfig(
  config: Config,
  worktree: string,
): Config["memory"] {
  if (config.memory) return config.memory;
  // A real log is not required for wiring: `fapony init` scaffolds an empty
  // `.fapony/.memory/` and the writer creates the first log there.
  if (_resolveMemDir(worktree) || walkUpForMemDir(worktree, true)) {
    return DEFAULT_MEMORY;
  }
  return null;
}

export function closeMemory(
  config: Config,
  worktree: string,
  memId: string,
  msg: string,
): void {
  const mem = resolveMemoryConfig(config, worktree);
  if (!mem) return;
  try {
    const cmd = templateArgs(mem.close, { id: memId, msg });
    assertSafe(cmd, config.safety?.deny ?? []);
    execSync(cmd.join(" "), {
      cwd: worktree,
      stdio: "ignore",
      timeout: 15_000,
    });
  } catch {
    // non-fatal, same as existing call sites
  }
}

export function claimMemory(
  config: Config,
  worktree: string,
  memId: string,
): boolean {
  const mem = resolveMemoryConfig(config, worktree);
  if (!mem) return false;
  try {
    const cmd = templateArgs(mem.claim, { id: memId });
    assertSafe(cmd, config.safety?.deny ?? []);
    execSync(cmd.join(" "), {
      cwd: worktree,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Runs memory.kickoff (if configured or default-wired) and returns its stdout, or null if unset/failed. */
export function kickoffMemory(config: Config, worktree: string): string | null {
  const mem = resolveMemoryConfig(config, worktree);
  if (!mem?.kickoff) return null;
  try {
    assertSafe(mem.kickoff, config.safety?.deny ?? []);
    return execSync(mem.kickoff.join(" "), {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
