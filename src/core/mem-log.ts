// src/core/mem-log.ts — mem-log reader: directory discovery + JSONL parsing (pure, no feature imports)
//
// Extracted from src/memory.ts (PLAN-lib-layer chunk 2b). Shell adapter
// helpers (closeMemory, kickoffMemory, claimMemory) stay in memory.ts.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  CONFIG_FILENAME,
  DEFAULT_MEM_DIR,
  FAPONY_DIR,
  loadConfig,
} from "./config.js";

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
  /** Problem identity, distinct from kind (action) and files[] (place) — written by `mem add --key` (PLAN-mem-keys chunk 1). */
  key?: string;
  /** Row schema version: 2 = may carry `key`; absent = v:1 legacy row, read as-is. */
  v?: number;
}

/** One mem-row text budget for any hint/seed surface that shows a row (was context-data's private const). */
export const MEM_TEXT_MAX = 120;

/** Cut a row's text to MEM_TEXT_MAX at a word boundary, marked with `…` — never mid-word. */
export function clipMemText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MEM_TEXT_MAX) return flat;
  const cut = flat.slice(0, MEM_TEXT_MAX - 1);
  const space = cut.lastIndexOf(" ");
  // ponytail: no space in the back half (one long token/path) = hard cut
  return `${(space > MEM_TEXT_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The only accepted shape of a mem row `key` — problem identity, not action
 * (kind) and not place (files[]). Lives here in core so CLI and MCP validate
 * through one regex (PLAN-unify-mem-engine: one engine, both surfaces).
 *
 * Bare (`fix-stop-dedupe`) or namespaced (`auth:login`, `nope:x`): the domain
 * half is checked against `.fapony/keys.json` when that file exists
 * (PLAN-mem-core chunk 4); the sub half is free (≥1 char — it names one
 * problem, not a namespace). One colon at most — the engine splits on the
 * first one, so a second colon never validates.
 */
export const KEY_RE = /^[a-z0-9-]{3,40}(:[a-z0-9-]{1,40})?$/;

/** A single key segment (domain in the registry, sub after the colon). */
export const KEY_SEGMENT_RE = /^[a-z0-9-]{3,40}$/;

interface RawMemRow {
  ts?: string;
  agent?: string;
  kind?: string;
  text?: string;
  spec?: string;
  id?: string;
  ref?: string;
  files?: unknown;
  key?: unknown;
  v?: unknown;
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
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
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
export function walkUpForMemDir(
  fromDir: string,
  acceptEmpty: boolean,
): string | null {
  const start = resolve(fromDir);
  const boundary = repoRootOf(start) ?? "/";
  let dir = start;
  while (true) {
    const candidate = join(dir, DEFAULT_MEM_DIR);
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
  step: "flag" | "config" | "walk-up" | "repo-root" | "ambiguous" | "none";
  candidates?: string[];
}

// Dirs that never hold a project mem log and are expensive to walk.
const SCAN_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "vendor",
  "out",
  "target",
  ".next",
  ".turbo",
  ".cache",
]);

/**
 * Every `.fapony/.memory/` under `root` that holds a real log, bounded to a
 * shallow walk. Used only to detect the ambiguous monorepo layout (SPEC §1
 * fail example): if two or more app-scoped logs exist and nothing at/above cwd
 * holds one, the caller must refuse rather than start a third log at the root.
 */
function findMemDirsUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 5) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === FAPONY_DIR) {
        const candidate = join(dir, DEFAULT_MEM_DIR);
        if (hasMemLogs(candidate)) found.push(candidate);
        continue;
      }
      if (e.name.startsWith(".") || SCAN_SKIP.has(e.name)) continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * The single resolver: returns the mem dir and which step won.
 *
 * Resolution order (SPEC §1):
 *   1. `--mem-dir <path>` (wins over everything)
 *   2. `paths.memDir` in the **repo-root** `fapony.config.json` (relative to root)
 *   3. walk up from cwd for the first `.fapony/.memory/` that holds a real log
 *   4. `<repo root>/.fapony/.memory/`
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

  // Step 2: paths.memDir in the repo-root config
  const configDir = root ?? cwd;
  try {
    const configPath = join(configDir, CONFIG_FILENAME);
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

  // Guard (SPEC §1 fail example)
  const candidates = root ? findMemDirsUnder(root) : [];
  if (candidates.length >= 2) {
    return { dir: null, step: "ambiguous", candidates };
  }
  const outOfScope = candidates.length ? { candidates } : {};

  // Step 4: <repo root>/.fapony/.memory/
  if (root) {
    const rootDir = join(root, DEFAULT_MEM_DIR);
    if (existsSync(rootDir)) {
      return { dir: rootDir, step: "repo-root", ...outOfScope };
    }
  }

  return { dir: null, step: "none", ...outOfScope };
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
        ...(typeof parsed.key === "string" ? { key: parsed.key } : {}),
        ...(typeof parsed.v === "number" ? { v: parsed.v } : {}),
      });
    }
  }

  all.sort((a, b) => b.ts.localeCompare(a.ts)); // newest first
  return { rows: all, skipped, filesFound: files.length };
}

/**
 * Decisions for the pre-edit context summary — newest first, capped at `limit`.
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
