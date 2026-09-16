// src/usage/scan.ts — fapony usage-scan command
//
// Scans session logs for all four clients, writes usage-cache.jsonl.
// Windowed replace (30d default, all-time with --full) — never incremental.
// Per-worktree + global aggregate — the cache now carries a worktree dimension.
// Progress bar on TTY, plain lines on pipe/CI.

import { loadConfig, openDb } from "../db/index.js";
import { CLIENTS } from "../session/index.js";
import type { PassiveUsageResult } from "../session/types.js";
import {
  type CacheEntry,
  cacheMeta,
  mergeEntries,
  readCache,
  writeCache,
} from "./cache.js";

const DEFAULT_JSONL_LOOKBACK_DAYS = 30;

function toCacheEntry(
  client: string,
  result: PassiveUsageResult,
  worktree?: string,
): CacheEntry {
  return {
    client,
    worktree: worktree ?? null,
    scanned_at: new Date().toISOString(),
    session_count: result.session_count,
    total_tokens_input: result.total_tokens_input,
    total_tokens_output: result.total_tokens_output,
    total_tokens_reasoning: result.total_tokens_reasoning,
    total_tokens_cache_read: result.total_tokens_cache_read,
    total_tokens_cache_write: result.total_tokens_cache_write,
    total_cost: result.total_cost,
    by_model: result.by_model.map((m) => ({
      model: m.model,
      provider: m.provider,
      session_count: m.session_count,
      tokens_input: m.tokens_input,
      tokens_output: m.tokens_output,
      tokens_reasoning: m.tokens_reasoning,
      tokens_cache_read: m.tokens_cache_read,
      tokens_cache_write: m.tokens_cache_write,
      cost: m.cost,
    })),
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Surface a per-client problem without aborting the scan of the others. */
function warn(scope: string, detail: string, isTTY: boolean): void {
  process.stderr.write(
    isTTY ? `\n  ⚠ ${scope}: ${detail}\n` : `  warn: ${scope}: ${detail}\n`,
  );
}

function progress(msg: string, isTTY: boolean): void {
  if (isTTY) {
    process.stderr.write(`\r\x1B[K${msg}`);
  } else {
    process.stderr.write(`${msg}\n`);
  }
}

export function cmdUsageScan(rawArgs: string[]): void {
  const full = rawArgs.includes("--full");
  const args = rawArgs.filter((a) => a !== "--full");
  const config = loadConfig();
  const isTTY = !!process.stderr.isTTY;

  if (args[0] && args[0] !== "--full") {
    console.error("usage: fapony usage-scan [--full]");
    process.exit(1);
  }

  const existing = readCache(config);

  const windowSince = full
    ? undefined
    : Date.now() / 1000 - DEFAULT_JSONL_LOOKBACK_DAYS * 86400;

  // Collect distinct worktrees from runs table (the source of truth for projects).
  const db = openDb();
  let worktrees: string[];
  try {
    worktrees = (
      db
        .prepare("SELECT DISTINCT worktree FROM runs WHERE worktree != ''")
        .all() as { worktree: string }[]
    )
      .map((r) => r.worktree)
      .sort();
  } finally {
    db.close();
  }

  // Scan targets: per worktree + global (null = aggregate).
  const scanTargets: Array<{ label: string; worktree?: string }> = [
    ...worktrees.map((wt) => ({ label: wt, worktree: wt })),
    { label: "all projects" },
  ];

  const totalSteps = scanTargets.length * CLIENTS.length;
  let step = 0;

  const entries: CacheEntry[] = [];

  for (const target of scanTargets) {
    const wt = target.worktree;

    for (const client of CLIENTS) {
      step++;
      const pct = Math.round((step / totalSteps) * 100);
      const bar = `[${"█".repeat(Math.round(pct / 5))}${"░".repeat(20 - Math.round(pct / 5))}]`;
      const label = client.scanLabel ?? client.key;
      const scopeLabel = wt ? `${target.label}/${label}` : label;
      progress(
        `${scopeLabel}  ${bar}  ${step}/${totalSteps}  (${pct}%)`,
        isTTY,
      );

      try {
        const result = client.read(wt, windowSince, undefined, false, full);
        // A failed read returns zeros WITH a code — the same shape as "no
        // sessions", so it gets dropped below and would otherwise leave the
        // cache silently short one client. Say it out loud instead.
        if (result.error) warn(scopeLabel, result.error, isTTY);
        // A broken client is cached too, precisely because it has no sessions
        // to speak for it — otherwise it just vanishes from usage-web.
        if (result.session_count > 0 || result.error) {
          entries.push(toCacheEntry(client.key, result, wt));
        }
      } catch (err) {
        warn(scopeLabel, String(err), isTTY);
      }
    }
  }

  // Merge with existing and write.
  const merged = mergeEntries(existing, entries);
  writeCache(merged, config);

  const finalMeta = cacheMeta(merged);
  if (isTTY) {
    process.stderr.write(
      `\r\x1B[Kscan done — ${finalMeta?.total_sessions ?? 0} sessions cached (${entries.length} entries written, ${worktrees.length} projects)\n`,
    );
  } else {
    process.stderr.write(
      `scan done — ${finalMeta?.total_sessions ?? 0} sessions cached (${entries.length} entries written, ${worktrees.length} projects)\n`,
    );
  }

  console.log(`cache written to ${cachePathHint(config)}`);
}

function cachePathHint(_config?: ReturnType<typeof loadConfig>): string {
  return "usage-cache.jsonl";
}
