// src/debt/load.ts — conventions.json resolution + parsing.
//
// The convention definition lives in the measured repo
// (<repo>/.fapony/conventions.json — via the same resolver as the mem log).
// Missing file = empty + no error.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONVENTIONS_FILE,
  CONVENTIONS_FILENAME,
  FAPONY_DIR,
} from "../core/config.js";
import { resolveMemDir } from "../memory.js";
import type { Convention, LoadedConventions } from "./types.js";

export function resolveConventionsPath(worktree: string): string | null {
  // Conventions live in the same .fapony/ dir as the mem log — derive from
  // the resolved mem dir so both resolvers cannot drift apart.
  const memDir = resolveMemDir(worktree);
  const base = memDir ? join(memDir, "..") : join(worktree, FAPONY_DIR);
  const app = join(base, CONVENTIONS_FILENAME);
  if (existsSync(app)) return app;
  // Monorepo where the app has not scaffolded .fapony/ yet, and single repos
  // that ran `fapony init` at the root — the root file still scopes fine
  // because every `where` is repo-relative.
  const root = join(worktree, CONVENTIONS_FILE);
  return existsSync(root) ? root : null;
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
