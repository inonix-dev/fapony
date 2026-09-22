// src/usage/cache.ts — JSONL usage cache
//
// One line per client (opencode / zcode / claude_code / codex).
// Stored in the fapony state dir (~/.config/fapony/usage-cache.jsonl).
// Atomic write: write to .tmp then rename.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type Config, faponyDir } from "../core/config.js";

const CACHE_FILENAME = "usage-cache.jsonl";

export interface CacheEntry {
  client: string;
  /** Worktree path this entry scopes to, or undefined/null for the global aggregate. */
  worktree?: string | null;
  scanned_at: string;
  session_count: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens_reasoning: number;
  total_tokens_cache_read: number;
  total_tokens_cache_write: number;
  total_cost: number;
  by_model: {
    model: string;
    provider: string;
    session_count: number;
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
    tokens_cache_read: number;
    tokens_cache_write: number;
    cost: number;
  }[];
  /**
   * Why this client's row is empty, when it is. Absent on a healthy scan.
   *
   * Carried so usage-web can tell "this client was never used" apart from
   * "this client's log could not be read" — both are zero rows otherwise.
   */
  error?: string;
}

export interface CacheMeta {
  scanned_at: string;
  total_sessions: number;
}

export function cachePath(config?: Config): string {
  return join(faponyDir(config), CACHE_FILENAME);
}

/** Read all entries from the JSONL cache file. Returns [] when missing or empty. */
export function readCache(config?: Config): CacheEntry[] {
  const p = cachePath(config);
  if (!existsSync(p)) return [];

  try {
    const raw = readFileSync(p, "utf-8");
    if (!raw.trim()) return [];
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as CacheEntry);
  } catch {
    return [];
  }
}

/**
 * Write entries to the cache file atomically (temp + rename).
 * Creates the state dir when missing (fresh-machine first scan).
 */
export function writeCache(entries: CacheEntry[], config?: Config): void {
  const p = cachePath(config);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  const content = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, p);
}

/**
 * Merge new entry into existing cache entries.
 * Dedup by `client + worktree` — last write wins (newest scanned_at wins).
 */
export function mergeEntries(
  existing: CacheEntry[],
  updated: CacheEntry[],
): CacheEntry[] {
  const byKey = new Map<string, CacheEntry>();
  for (const e of existing) byKey.set(`${e.client}\0${e.worktree ?? ""}`, e);
  for (const e of updated) byKey.set(`${e.client}\0${e.worktree ?? ""}`, e);
  return Array.from(byKey.values());
}

/**
 * Freshness + session total from cache.
 *
 * Totals come from the global (worktree-null) rows only — per-worktree rows
 * are subsets of that aggregate, so summing everything double-counts
 * (global 100 + projects 60 + 40 reported 200). Pre-dimension caches carry
 * no worktree field at all, so when no global row exists every entry counts.
 */
export function cacheMeta(entries: CacheEntry[]): CacheMeta | null {
  if (entries.length === 0) return null;
  const scoped = entries.some((e) => (e.worktree ?? null) === null)
    ? entries.filter((e) => (e.worktree ?? null) === null)
    : entries;
  let oldest = scoped[0].scanned_at;
  let total = 0;
  for (const e of scoped) {
    if (e.scanned_at < oldest) oldest = e.scanned_at;
    total += e.session_count;
  }
  return { scanned_at: oldest, total_sessions: total };
}
