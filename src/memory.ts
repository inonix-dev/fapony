// src/memory.ts — shell adapter helpers for config.memory.*
// ponytail: dedupe close-command logic that was copy-pasted in run.ts + stop.ts

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type Config,
  DEFAULT_MEMORY_ENTRY,
  memoryEntry,
  safetyDeny,
} from "./db/index.js";
import { assertSafe } from "./safety.js";
import { templateArgs } from "./util.js";

/** Default memory commands — matches templates/mem/mem.ts CLI. */
export const DEFAULT_MEMORY: Config["memory"] = {
  claim: ["bun", DEFAULT_MEMORY_ENTRY, "claim", "{id}"],
  close: ["bun", DEFAULT_MEMORY_ENTRY, "close", "{id}", "{msg}"],
  add: ["bun", DEFAULT_MEMORY_ENTRY, "add", "{kind}", "{text}"],
  kickoff: ["bun", DEFAULT_MEMORY_ENTRY, "kickoff"],
};

/**
 * Returns the effective memory config:
 * - explicit config.memory wins if set
 * - fallback: config.memory === null + <memoryEntry> exists → DEFAULT_MEMORY
 * - otherwise null (no memory)
 */
export function resolveMemoryConfig(
  config: Config,
  worktree: string,
): Config["memory"] {
  if (config.memory) return config.memory;
  if (existsSync(join(worktree, memoryEntry(config)))) return DEFAULT_MEMORY;
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
    assertSafe(cmd, safetyDeny(config));
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
    assertSafe(cmd, safetyDeny(config));
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
    assertSafe(mem.kickoff, safetyDeny(config));
    return execSync(mem.kickoff.join(" "), {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
