// src/memory.ts — memory domain: config.memory.* shell adapter helpers +
// the shared mem-log reader (digest and project_health_context both need it).
// ponytail: dedupe close-command logic that was copy-pasted in run.ts + stop.ts

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { type Config, loadConfig, safetyDeny } from "./db/index.js";
import { assertSafe } from "./safety.js";
import { templateArgs } from "./util.js";

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
 *
 * Since PLAN-agent-one-call the code is built into fapony (`fapony mem`), so the
 * old gate on `.fapony/.memory/mem.ts` no longer means anything — that file is
 * not scaffolded and `init-mem` deletes it. Gate on the dir the writer needs.
 */
export function resolveMemoryConfig(
  config: Config,
  worktree: string,
): Config["memory"] {
  if (config.memory) return config.memory;
  // A real log is not required for wiring: `fapony init` scaffolds an empty
  // `.fapony/.memory/` and the writer creates the first log there. Resolution
  // proper (above) still skips empty dirs, so it cannot pick the wrong one.
  if (resolveMemDir(worktree) || walkUpForMemDir(worktree, true)) {
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
 * A directory is a mem dir only when it holds a `log.jsonl` or a named
 * `log.<person>.jsonl` (rotated `log.YYYY-MM-DD.jsonl` archives count too).
 * A `.fapony/.memory/` scaffolded empty by `fapony init` is not a candidate —
 * otherwise it would shadow an ancestor that holds the real log (SPEC §1).
 */
function hasMemLogs(dir: string): boolean {
  try {
    return readdirSync(dir).some(
      (f) => f === "log.jsonl" || /^log\.[A-Za-z0-9._-]+\.jsonl$/.test(f),
    );
  } catch {
    return false;
  }
}

/** Physical path (symlinks resolved) so start and repo root compare like with
 *  like; falls back to a lexical resolve when the path does not exist yet. */
function physical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** `git rev-parse --show-toplevel` from a directory, or null outside a repo. */
function gitRootOf(fromDir: string): string | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: fromDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

/**
 * The lexical ancestor of `fromDir` that is the git repo root, or null outside
 * a repo. `git rev-parse` returns a physical path (it resolves /var → /private/
 * var on macOS), so the walk compares `physical(dir)` against it and returns the
 * path in the caller's own lexical form — the returned dir must match what the
 * caller passed in, not a canonicalized stranger.
 */
function repoRootOf(fromDir: string): string | null {
  const start = resolve(fromDir);
  const gitRoot = gitRootOf(start);
  if (!gitRoot) return null;
  const physicalRoot = physical(gitRoot);
  let dir = start;
  while (true) {
    if (physical(dir) === physicalRoot) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Locate the nearest `.fapony/.memory/` by walking up from `fromDir`.
 *
 * The walk stops at the git repo root (SPEC §1) — a mem dir in a parent
 * checkout is never ours. Outside a repo it stops at the filesystem root.
 * `acceptEmpty` is for the default-wiring check, which only needs the dir the
 * writer will use (log or not); the resolver itself requires a real log.
 */
function walkUpForMemDir(fromDir: string, acceptEmpty: boolean): string | null {
  const start = resolve(fromDir);
  const boundary = repoRootOf(start) ?? "/";
  let dir = start;
  while (true) {
    const candidate = join(dir, ".fapony", ".memory");
    if (existsSync(candidate) && (acceptEmpty || hasMemLogs(candidate))) {
      return candidate;
    }
    if (dir === boundary) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface MemDirResult {
  dir: string | null;
  step: "flag" | "config" | "walk-up" | "repo-root" | "none";
}

/**
 * The single resolver: returns the mem dir and which step won.
 *
 * Resolution order (SPEC §1):
 *   1. `--mem-dir <path>` (wins over everything)
 *   2. `paths.memDir` in the **repo-root** `fapony.config.json` (relative to root)
 *   3. walk up from cwd for the first `.fapony/.memory/` that holds a real log
 *   4. `<repo root>/.fapony/.memory/`
 *
 * `.memory/` (outside `.fapony/`) and the monorepo app-guess (`wt-<app>`,
 * `MEM_APP`) are both dead — they are not in the order and never return.
 */
function resolveMemDirFrom(
  fromDir: string,
  explicitOverride?: string,
): MemDirResult {
  // Step 1: --mem-dir flag
  if (explicitOverride) {
    return {
      dir: existsSync(explicitOverride) ? resolve(explicitOverride) : null,
      step: "flag",
    };
  }

  const cwd = resolve(fromDir);
  const root = repoRootOf(cwd);

  // Step 2: paths.memDir in the repo-root config (FAPONY_CONFIG is not a
  // path source here — spec §1 pins this to fapony.config.json)
  const configDir = root ?? cwd;
  try {
    const configPath = join(configDir, "fapony.config.json");
    if (existsSync(configPath)) {
      const config = loadConfig(configPath);
      if (config?.paths?.memDir) {
        const absCfg = isAbsolute(config.paths.memDir)
          ? config.paths.memDir
          : join(configDir, config.paths.memDir);
        if (existsSync(absCfg)) return { dir: absCfg, step: "config" };
      }
    }
  } catch {
    // no config or unreadable — continue
  }

  // Step 3: walk up from cwd, only a dir with a real log counts
  const walked = walkUpForMemDir(cwd, false);
  if (walked) return { dir: walked, step: "walk-up" };

  // Step 4: <repo root>/.fapony/.memory/ — where a new log is created
  if (root) {
    const rootDir = join(root, ".fapony", ".memory");
    if (existsSync(rootDir)) return { dir: rootDir, step: "repo-root" };
  }

  return { dir: null, step: "none" };
}

export function resolveMemDir(
  worktree?: string,
  explicitOverride?: string,
): string | null {
  return resolveMemDirFrom(worktree ?? process.cwd(), explicitOverride).dir;
}

/** Resolve and report which step won — for `fapony mem where`. */
export function whereMemDir(
  fromDir?: string,
  explicitOverride?: string,
): MemDirResult {
  return resolveMemDirFrom(fromDir ?? process.cwd(), explicitOverride);
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

  // Every log*.jsonl, rotated archives (log.YYYY-MM-DD.jsonl) included. They
  // used to be excluded, which meant the day a repo crossed the rotate
  // threshold mem_find silently forgot everything already closed — the rows
  // most worth recalling. Rotate exists to keep the live file small, not to
  // decide what is still remembered.
  const isLogFile = (f: string): boolean =>
    f === "log.jsonl" || /^log\.[A-Za-z0-9._-]+\.jsonl$/.test(f);

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
