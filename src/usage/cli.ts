// src/usage/cli.ts — cmdUsageWeb + Bun.serve routes
//
// Reads from usage-cache.jsonl (written by `fapony usage-scan`).
// No live session scanning — serves static HTML.

import { loadConfig } from "../core/config.js";
import type { PassiveUsageResult } from "../session/types.js";
import { type CacheEntry, cacheMeta, readCache } from "./cache.js";
import { renderUsageHtml } from "./render.js";

function cacheToResult(entry: CacheEntry | undefined): PassiveUsageResult {
  if (!entry) {
    return {
      total_tokens_input: 0,
      total_tokens_output: 0,
      total_tokens_reasoning: 0,
      total_tokens_cache_read: 0,
      total_tokens_cache_write: 0,
      total_cost: 0,
      session_count: 0,
      by_model: [],
    };
  }
  return {
    total_tokens_input: entry.total_tokens_input,
    total_tokens_output: entry.total_tokens_output,
    total_tokens_reasoning: entry.total_tokens_reasoning,
    total_tokens_cache_read: entry.total_tokens_cache_read,
    total_tokens_cache_write: entry.total_tokens_cache_write,
    total_cost: entry.total_cost,
    session_count: entry.session_count,
    by_model: entry.by_model.map((m) => ({
      ...m,
    })),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

export function cmdUsageWeb(rawArgs: string[]): void {
  const config = loadConfig();
  const uw = config.usageWeb ?? {};

  if (rawArgs.includes("--full")) {
    console.error(
      "fapony usage-web: --full moved to `fapony usage-scan --full`",
    );
    process.exit(1);
  }

  const portArg = parseInt(rawArgs[0], 10);
  const port = Number.isNaN(portArg) ? (uw.port ?? 8080) : portArg;
  const hostname = rawArgs[1] || uw.hostname || "127.0.0.1";
  const ownerName = uw.ownerName?.trim() ? uw.ownerName.trim() : undefined;

  if (rawArgs[0] && Number.isNaN(parseInt(rawArgs[0], 10))) {
    console.error("usage: fapony usage-web [port] [hostname]");
    process.exit(1);
  }

  const entries = readCache(config);
  const meta = cacheMeta(entries);

  if (!meta) {
    console.error(
      "fapony usage-web: no usage cache found. Run `fapony usage-scan` first.",
    );
    process.exit(1);
  }

  // Group entries by worktree. Entries with worktree=null/undefined are the
  // global aggregate (backwards-compatible with pre-project-dimension caches).
  const byWorktree = new Map<string, CacheEntry[]>();
  for (const e of entries) {
    const wt = e.worktree ?? null;
    const key = wt ?? "__global__";
    let arr = byWorktree.get(key);
    if (!arr) {
      arr = [];
      byWorktree.set(key, arr);
    }
    arr.push(e);
  }

  // Build per-worktree data objects + a global summary.
  const projectData = new Map<
    string,
    {
      opencode: PassiveUsageResult;
      zcode: PassiveUsageResult;
      claude_code: PassiveUsageResult;
      codex: PassiveUsageResult;
    }
  >();

  for (const [key, clientEntries] of byWorktree) {
    const byClient = new Map(clientEntries.map((e) => [e.client, e]));
    const data = {
      opencode: cacheToResult(byClient.get("opencode")),
      zcode: cacheToResult(byClient.get("zcode")),
      claude_code: cacheToResult(byClient.get("claude_code")),
      codex: cacheToResult(byClient.get("codex")),
    };
    projectData.set(key, data);
  }

  const server = Bun.serve({
    hostname,
    port,
    fetch(_req) {
      const html = renderUsageHtml(projectData, meta.scanned_at, ownerName);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  console.log(
    `fapony usage-web → http://${server.hostname}:${server.port}  (cache: ${meta.scanned_at}, ${meta.total_sessions} sessions, ${byWorktree.size - (byWorktree.has("__global__") ? 1 : 0)} projects)`,
  );
}
