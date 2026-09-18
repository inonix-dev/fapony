// src/memory.ts — memory domain: config.memory.* shell adapter helpers +
// the shared mem-log reader (digest and project_health_context both need it).
// ponytail: dedupe close-command logic that was copy-pasted in run.ts + stop.ts

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

// --- mem log reading ---
//
// Shared by `fapony digest` and `project_health_context`: both need the same
// directory discovery (new `.fapony/.memory`, legacy `.memory/` fallback) and
// the same rotated-file handling. Kept here so the two callers cannot drift.

export interface MemRow {
  ts: string;
  agent: string;
  kind: string;
  text: string;
  spec?: string;
  id?: string;
  ref?: string;
  /** Files the row is about — written by `mem add --files` (PLAN-convention-debt chunk 3). */
  files?: string[];
}

interface RawMemRow {
  ts?: string;
  agent?: string;
  kind?: string;
  text?: string;
  spec?: string;
  id?: string;
  ref?: string;
  files?: unknown;
}

/**
 * The app's own .fapony/ dir for a worktree root — the same monorepo guess
 * resolveMemDir makes (templates/mem/store.ts is the mirror). Conventions
 * live beside the mem log (SPEC-convention-debt §2.1), so both resolvers must
 * guess identically; the guess is shared here so they cannot drift.
 */
export function resolveAppFaponyDir(worktree: string): string {
  const app = process.env.MEM_APP ?? basename(worktree).replace(/^wt-/, "");
  const appBase = ["apps", "packages", "services"]
    .map((d) => join(worktree, d, app))
    .find((p) => existsSync(p));
  return appBase ? join(appBase, ".fapony") : join(worktree, ".fapony");
}

/**
 * Locate the memory dir for a worktree root, mirroring templates/mem/store.ts:
 * in a monorepo the log lives under `<apps|packages|services>/<app>/.fapony/.memory`
 * (app guessed from the dir name, `wt-` prefix stripped; MEM_APP overrides), not
 * at the git root. Single repos fall back to the root-relative layout.
 */
export function resolveMemDir(worktree: string): string | null {
  const base = resolveAppFaponyDir(worktree);

  const legacyDir = join(base, "..", ".memory");
  const newDir = join(base, ".memory");

  if (existsSync(join(legacyDir, "log.jsonl"))) return legacyDir;
  if (existsSync(newDir)) return newDir;
  return null;
}

/**
 * Read every `log*.jsonl` row under the worktree's memory dir, newest first.
 * `sinceIso` (exclusive) drops older rows; omit it to read the whole log.
 * Malformed/unreadable rows are counted, never thrown — a corrupt line must
 * not take down the caller.
 */
export function readMemLog(
  worktree: string,
  sinceIso?: string,
): { rows: MemRow[]; skipped: number; filesFound: number } {
  const dir = resolveMemDir(worktree);
  if (!dir) return { rows: [], skipped: 0, filesFound: 0 };

  // read every log*.jsonl (excluding rotated files log.YYYY-MM-DD.jsonl)
  const isLogFile = (f: string): boolean =>
    f === "log.jsonl" ||
    (/^log\.[A-Za-z0-9._-]+\.jsonl$/.test(f) &&
      !/^log\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter(isLogFile)
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return { rows: [], skipped: 0, filesFound: 0 };
  }

  if (files.length === 0) return { rows: [], skipped: 0, filesFound: 0 };

  let skipped = 0;
  const all: MemRow[] = [];

  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      let parsed: RawMemRow;
      try {
        parsed = JSON.parse(line) as RawMemRow;
      } catch {
        skipped++;
        continue;
      }
      if (!parsed.ts || !parsed.kind) {
        skipped++;
        continue;
      }
      if (sinceIso && parsed.ts < sinceIso) continue;
      all.push({
        ts: parsed.ts,
        agent: parsed.agent ?? "unknown",
        kind: parsed.kind,
        text: parsed.text ?? "",
        spec: parsed.spec,
        id: parsed.id,
        ref: parsed.ref,
        ...(Array.isArray(parsed.files)
          ? { files: parsed.files.filter((f) => typeof f === "string") }
          : {}),
      });
    }
  }

  all.sort((a, b) => b.ts.localeCompare(a.ts)); // newest first
  return { rows: all, skipped, filesFound: files.length };
}

/**
 * Decisions for the pre-edit context summary — newest first, capped at `limit`.
 *
 * `keywords` (usual suspects: the files about to be touched) are a
 * *preference*, not a filter: decisions mentioning one surface first, but when
 * nothing matches the newest decisions still come back. A summary that goes
 * silent because a path never appeared in a decision is worse than a recent one.
 */
export function readRecentMemDecisions(
  worktree: string,
  limit: number,
  keywords?: string[],
): MemRow[] {
  let decisions: MemRow[];
  try {
    decisions = readMemLog(worktree).rows.filter((r) => r.kind === "decision");
  } catch {
    return [];
  }
  if (decisions.length === 0) return [];

  const kws = (keywords ?? [])
    .map((k) => k.toLowerCase())
    .filter((k) => k.length > 0);
  if (kws.length > 0) {
    const hits = decisions.filter((r) => {
      const hay = `${r.text}\n${r.spec ?? ""}`.toLowerCase();
      return kws.some((k) => hay.includes(k));
    });
    if (hits.length > 0) return hits.slice(0, limit);
  }
  return decisions.slice(0, limit);
}
