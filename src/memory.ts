// src/memory.ts — config.memory.* shell adapter helpers for the frozen ledger
// (gate.ts). Runs only commands the user configured; reading memory is
// src/fael.ts.

import { execSync } from "node:child_process";
import type { Config } from "./core/config.js";
import { assertSafe } from "./safety.js";
import { templateArgs } from "./util.js";

/** config.memory when set — nothing is wired by default any more (memory
 *  moved to fael, which has its own commands). */
const resolveMemoryConfig = (config: Config): Config["memory"] =>
  config.memory ?? null;

export function closeMemory(
  config: Config,
  worktree: string,
  memId: string,
  msg: string,
): void {
  const mem = resolveMemoryConfig(config);
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

/** Runs memory.kickoff (if configured) and returns its stdout, or null if unset/failed. */
export function kickoffMemory(config: Config, worktree: string): string | null {
  const mem = resolveMemoryConfig(config);
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
