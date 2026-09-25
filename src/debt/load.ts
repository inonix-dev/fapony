// src/debt/load.ts — conventions.json resolution + parsing.
//
// The convention definition lives in the measured repo
// (<repo>/.fapony/conventions.json — via the same resolver as the mem log).
// Missing file = empty + no error.

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CONVENTIONS_FILE,
  CONVENTIONS_FILENAME,
  FAPONY_DIR,
} from "../core/config.js";
import { faponyDirFrom } from "../core/fapony-dir.js";
import type { Convention, LoadedConventions } from "./types.js";

export function resolveConventionsPath(worktree: string): string | null {
  // Conventions live in the nearest .fapony/ — the same dir `fapony plan` uses.
  const base = faponyDirFrom(worktree);
  const app = join(base, CONVENTIONS_FILENAME);
  if (existsSync(app)) return app;
  // Monorepo where the app has not scaffolded .fapony/ yet, and single repos
  // that ran `fapony init` at the root — the root file still scopes fine
  // because every `where` is repo-relative.
  const root = join(worktree, CONVENTIONS_FILE);
  return existsSync(root) ? root : null;
}

export interface DebtScope {
  /**
   * The dir `where` clauses and debt rel-paths are measured against — the git
   * root inside a repo (convention `where` values are repo-relative), the
   * resolved start dir outside one.
   */
  scanRoot: string;
  /** Conventions in scope: nearest file walking up, else the lone file under the root. */
  loaded: LoadedConventions;
}

// Dirs that never hold a conventions.json and are expensive to walk — same
// prune set as the mem-log ambiguity scan (src/core/mem-log.ts).
const SCOPE_SKIP = new Set([
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

/** Every `.fapony/conventions.json` under root — bounded walk, pruned dirs skipped. */
function findConventionsUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === FAPONY_DIR) {
        const f = join(dir, FAPONY_DIR, CONVENTIONS_FILENAME);
        if (existsSync(f)) found.push(f);
        continue;
      }
      if (e.name.startsWith(".") || SCOPE_SKIP.has(e.name)) continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * The single debt-scope resolver — hint (`readContextData`), the precision
 * instrument (`computeHintImpact`), and `fapony debt` all pair the same
 * scan root with the same conventions (bugs mucvfaxk + mucvfiv5).
 *
 * Each caller previously resolved differently: the hint and the instrument
 * anchored `loadConventions` at the git root (silent whenever conventions are
 * app-scoped), while the CLI scanned from the app dir (so repo-relative
 * `where` values never matched and files outside the app were invisible).
 * The scan root here is always the git root — `where` is repo-relative —
 * and the conventions are the nearest file walking up from `fromDir`
 * (the app case); when the walk misses — a file outside any app dir, or the
 * repo root itself — the lone `conventions.json` under the root wins.
 * Two or more files under the root stay ambiguous (null, don't guess).
 */
export function resolveDebtScope(fromDir: string): DebtScope {
  let start = resolve(fromDir);
  try {
    if (!statSync(start).isDirectory()) start = dirname(start);
  } catch {
    // nonexistent path — keep the lexical form, resolution below still applies
  }
  try {
    // Physical path so the walk, the boundary check, and scanRoot compare
    // like with like (/var → /private/var on macOS).
    start = realpathSync(start);
  } catch {
    // vanished mid-call — keep the lexical form
  }
  // `git rev-parse` returns a physical path (/var → /private/var on macOS),
  // so the boundary check compares realpaths, same as worktreeOf in cli.ts.
  const physical = (d: string): string => {
    try {
      return realpathSync(d);
    } catch {
      return d;
    }
  };
  let gitRoot: string | null = null;
  try {
    const p = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: start,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode === 0) gitRoot = p.stdout.toString().trim() || null;
  } catch {
    // not a repo — start is all we have
  }
  const scanRoot = gitRoot ? physical(gitRoot) : start;
  const boundary = gitRoot ? physical(gitRoot) : null;

  // Nearest conventions.json walking up (the app case) — bounded by the root.
  let dir = start;
  while (true) {
    if (existsSync(join(dir, CONVENTIONS_FILE))) {
      return { scanRoot, loaded: loadConventions(dir) };
    }
    if (boundary && physical(dir) === boundary) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Sibling-app case: the file sits outside any app dir (e.g. packages/*),
  // but the repo holds exactly one conventions file — use it.
  if (gitRoot) {
    const found = findConventionsUnder(scanRoot);
    if (found.length === 1) {
      return { scanRoot, loaded: loadConventions(dirname(dirname(found[0]))) };
    }
  }
  return { scanRoot, loaded: loadConventions(scanRoot) };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Parses .fapony/conventions.json. Missing file = empty + no error (SPEC §6). */
export function loadConventions(worktree: string): LoadedConventions {
  const path = resolveConventionsPath(worktree);
  if (!path) return { path: null, convs: [], warnings: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return {
      path,
      convs: [],
      warnings: [`conventions.json unreadable: ${path}`],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      path,
      convs: [],
      warnings: [
        `conventions.json is not valid JSON — ${
          e instanceof Error ? e.message.split("\n")[0] : "parse error"
        }`,
      ],
    };
  }
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { conventions?: unknown }).conventions)
      ? (parsed as { conventions: unknown[] }).conventions
      : [];
  const convs: Convention[] = [];
  const warnings: string[] = [];
  rows.forEach((r, i) => {
    const o = r as Record<string, unknown>;
    const id = asString(o.id);
    const rule = asString(o.rule);
    if (!id || !rule) {
      warnings.push(
        `conventions[${i}]: id and rule are required — row dropped`,
      );
      return;
    }
    convs.push({
      id,
      rule,
      where: asString(o.where) ?? ".",
      stale: asString(o.stale) ?? null,
      ok: asString(o.ok),
      guard: asString(o.guard),
      checker: asString(o.checker) ?? null,
      decided: o.decided === "no-checker" ? "no-checker" : null,
    });
  });
  return { path, convs, warnings };
}
