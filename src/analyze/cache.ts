// src/analyze/cache.ts — session-scoped graph cache.
//
// buildGraph is cheap on this repo (~50ms/150 files) but the Edit hint calls it
// on every Edit — and a Claude Code PreToolUse hook is a *fresh process per
// tool call*, so an in-process cache alone never survives to the next edit. The
// graph is therefore mirrored to <faponyDir>/graph-cache/<key>.json:
//   - auto-build: every build is written through, best-effort (never blocks)
//   - auto-invalidate: a fingerprint over the source-file set (rel path + size
//     + mtimeMs) is stored beside the graph; a mismatch means rebuild
//   - cost: the cache file is only stat-ed when there is one to validate, so a
//     first-ever call pays build + write; later calls pay a walk + stat + parse,
//     well under a rebuild on any repo large enough for this to matter
// Everything here is derived state — an unreadable, corrupt, stale or
// unwritable cache falls back to a live build and no code path trusts it.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { faponyDir } from "../core/config.js";
import { collectSourceFiles } from "./discover.js";
import { buildGraph } from "./graph.js";
import type { ImportGraph } from "./types.js";

const GRAPH_CACHE_VERSION = 1;
const GRAPH_CACHE_DIR = "graph-cache";

interface SerializedGraph {
  v: number;
  fp: string;
  files: string[];
  deps: Record<string, string[]>;
  dependents: Record<string, string[]>;
  unresolved: number;
  external: number;
  barrels: string[];
}

let _graphCache: { dir: string; fp: string; graph: ImportGraph } | null = null;

/** Drop the in-process graph cache (tests simulate a fresh hook process). */
export function resetGraphCache(): void {
  _graphCache = null;
}

/** Absolute path of a worktree's graph-cache file — may not exist. */
export function graphCachePath(dir: string): string {
  const abs = resolve(dir);
  const slug = abs.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60);
  return join(
    faponyDir(),
    GRAPH_CACHE_DIR,
    `${slug}-${Bun.hash(abs).toString(36)}.json`,
  );
}

// The graph changes only when the set of source files or their bytes change —
// size/mtime/ctime catch that without reading any file. ctime rides the same
// stat call for free and cannot be forged like mtime can (only the system
// moves it), so an mtime-preserving rewrite still invalidates.
function graphFingerprint(absDir: string): string {
  const parts: string[] = [];
  for (const rel of collectSourceFiles(absDir)) {
    try {
      const st = statSync(join(absDir, rel));
      parts.push(
        `${rel}\u0000${st.size}\u0000${st.mtimeMs}\u0000${st.ctimeMs}`,
      );
    } catch {
      parts.push(`${rel}\u0000?\u0000?\u0000?`);
    }
  }
  return Bun.hash(parts.join("\n")).toString(36);
}

function serializeGraph(graph: ImportGraph, fp: string): SerializedGraph {
  const rec = (m: Map<string, Set<string>>): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [k, v] of m) out[k] = [...v];
    return out;
  };
  return {
    v: GRAPH_CACHE_VERSION,
    fp,
    files: graph.files,
    deps: rec(graph.deps),
    dependents: rec(graph.dependents),
    unresolved: graph.unresolved,
    external: graph.external,
    barrels: [...graph.barrels],
  };
}

function hydrateGraph(c: SerializedGraph): ImportGraph {
  const toMap = (r: Record<string, string[]>): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const [k, v] of Object.entries(r)) m.set(k, new Set(v));
    return m;
  };
  return {
    files: c.files,
    deps: toMap(c.deps),
    dependents: toMap(c.dependents),
    unresolved: c.unresolved,
    external: c.external,
    barrels: new Set(c.barrels),
  };
}

function readCachedGraph(path: string, fp: string): ImportGraph | null {
  try {
    const cached = JSON.parse(readFileSync(path, "utf-8")) as SerializedGraph;
    if (cached.v !== GRAPH_CACHE_VERSION || cached.fp !== fp) return null;
    return hydrateGraph(cached);
  } catch {
    return null;
  }
}

function writeCachedGraph(path: string, graph: ImportGraph, fp: string): void {
  try {
    if (!existsSync(join(faponyDir(), GRAPH_CACHE_DIR))) {
      mkdirSync(join(faponyDir(), GRAPH_CACHE_DIR), { recursive: true });
    }
    // pid-suffixed temp + rename: a reader never sees a half-written file even
    // when two hook processes race.
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(serializeGraph(graph, fp)), "utf-8");
    renameSync(tmp, path);
  } catch {
    // best-effort — a cache that cannot be written must not break the caller
  }
}

export function buildGraphCached(dir: string): ImportGraph {
  const abs = resolve(dir);
  // One walk per call: the fingerprint doubles as the in-process validity
  // check, so a same-process second call after an edit rebuilds instead of
  // serving the stale graph. A drift between this fp and the built graph
  // self-heals — the next call recomputes and rebuilds again.
  const fp = graphFingerprint(abs);
  if (_graphCache?.dir === abs && _graphCache.fp === fp)
    return _graphCache.graph;
  const path = graphCachePath(abs);
  if (existsSync(path)) {
    const cached = readCachedGraph(path, fp);
    if (cached) {
      _graphCache = { dir: abs, fp, graph: cached };
      return cached;
    }
  }
  const graph = buildGraph(abs);
  _graphCache = { dir: abs, fp, graph };
  writeCachedGraph(path, graph, fp);
  return graph;
}
