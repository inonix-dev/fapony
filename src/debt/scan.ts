// src/debt/scan.ts — the scan (fresh every call — derive, never store).
//
// Debt is computed live every time, never written anywhere (same as analyze:
// a cache is pure debt — a frozen list goes stale silently like MASTER.md).

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { collectSourceFiles } from "../analyze.js";
import {
  type Convention,
  DEBT_FILE_CAP,
  type DebtEntry,
  type DebtReport,
  type LoadedConventions,
} from "./types.js";

interface Compiled {
  conv: Convention;
  staleRe: RegExp | null;
  okRe: RegExp | null;
  guardRe: RegExp | null;
  whereDir: string;
}

function compile(conv: Convention): { c: Compiled; error?: string } {
  const re = (
    src: string | null | undefined,
    what: string,
  ): { re: RegExp | null; error?: string } => {
    if (!src) return { re: null };
    try {
      return { re: new RegExp(src) };
    } catch (e) {
      return {
        re: null,
        error: `${what} regex broken (${e instanceof Error ? e.message.split("\n")[0] : "?"})`,
      };
    }
  };
  const stale = re(conv.stale, `${conv.id}: stale`);
  if (stale.error)
    return {
      c: {
        conv,
        staleRe: null,
        okRe: null,
        guardRe: null,
        whereDir: conv.where,
      },
      error: stale.error,
    };
  const ok = re(conv.ok, `${conv.id}: ok`);
  if (ok.error)
    return {
      c: {
        conv,
        staleRe: null,
        okRe: null,
        guardRe: null,
        whereDir: conv.where,
      },
      error: ok.error,
    };
  const guard = re(conv.guard, `${conv.id}: guard`);
  if (guard.error)
    return {
      c: {
        conv,
        staleRe: null,
        okRe: null,
        guardRe: null,
        whereDir: conv.where,
      },
      error: guard.error,
    };
  return {
    c: {
      conv,
      staleRe: stale.re,
      okRe: ok.re,
      guardRe: guard.re,
      // where="src" must scope src/ and src/x/y.ts but not src-other/;
      // where="." scopes everything.
      whereDir: conv.where === "." ? "" : conv.where.replace(/\/+$/, ""),
    },
  };
}

function inScope(whereDir: string, file: string): boolean {
  return whereDir === "" || file.startsWith(`${whereDir}/`);
}

export function debtScan(
  worktree: string,
  loaded: LoadedConventions,
): DebtReport {
  const t0 = performance.now();
  const entries: DebtEntry[] = [];
  const declared: Convention[] = [];
  const dropped: { id: string; reason: string }[] = [];
  let checkedCount = 0;

  const compiled: Compiled[] = [];
  for (const conv of loaded.convs) {
    if (conv.checker) {
      // Iron rule — fapony stays silent, leave it to the checker (SPEC §2)
      checkedCount++;
      continue;
    }
    if (!conv.stale) {
      // The one slot a human fills (SPEC §2.2) — show it as pending, don't guess
      declared.push(conv);
      continue;
    }
    const { c, error } = compile(conv);
    if (error || !c.staleRe) {
      dropped.push({ id: conv.id, reason: error ?? "uncompilable" });
      continue;
    }
    if (!existsSync(join(worktree, c.whereDir || "."))) {
      dropped.push({
        id: conv.id,
        reason: `where: ${conv.where} does not exist`,
      });
      continue;
    }
    compiled.push(c);
  }

  const files = collectSourceFiles(worktree);
  const debt: Map<string, string[]> = new Map(
    compiled.map((c) => [c.conv.id, []]),
  );
  const moved: Map<string, number> = new Map(
    compiled.map((c) => [c.conv.id, 0]),
  );
  const tooBroad: Map<string, number> = new Map();

  for (const rel of files) {
    let content: string;
    try {
      content = readFileSync(join(worktree, rel), "utf-8");
    } catch {
      continue;
    }
    for (const c of compiled) {
      if (!c.staleRe) continue; // filtered at compile; narrows the type
      if (!inScope(c.whereDir, rel)) continue;
      if (c.guardRe && !c.guardRe.test(content)) continue;
      if (c.staleRe.test(content)) {
        const cur = debt.get(c.conv.id) ?? [];
        cur.push(rel);
        debt.set(c.conv.id, cur);
        // Stop counting a runaway regex early — the entry will be dropped.
        if (cur.length > DEBT_FILE_CAP) tooBroad.set(c.conv.id, cur.length);
      }
      if (c.okRe?.test(content)) {
        moved.set(c.conv.id, (moved.get(c.conv.id) ?? 0) + 1);
      }
    }
  }

  for (const c of compiled) {
    const n = tooBroad.get(c.conv.id);
    if (n !== undefined) {
      dropped.push({
        id: c.conv.id,
        reason: `stale regex matches ${n}+ files — too broad, entry dropped (narrow stale/where/guard)`,
      });
      continue;
    }
    entries.push({
      conv: c.conv,
      files: (debt.get(c.conv.id) ?? []).sort(),
      movedCount: c.okRe ? (moved.get(c.conv.id) ?? 0) : null,
    });
  }

  return {
    worktree,
    scannedFiles: files.length,
    ms: Math.round(performance.now() - t0),
    entries,
    declared,
    dropped,
    checkedCount,
  };
}

/** Per-file lookup (hook-read-hint + --files): which conventions flag this file. */
export function debtForFile(
  worktree: string,
  absFile: string,
  loaded: LoadedConventions,
): Convention[] {
  const rel = relative(worktree, absFile).split("\\").join("/");
  if (rel.startsWith("..") || isAbsolute(rel)) return [];
  let content: string;
  try {
    content = readFileSync(absFile, "utf-8");
  } catch {
    return [];
  }
  const out: Convention[] = [];
  for (const conv of loaded.convs) {
    if (conv.checker || !conv.stale) continue;
    const { c, error } = compile(conv);
    if (error || !c.staleRe) continue;
    if (!inScope(c.whereDir, rel)) continue;
    if (c.guardRe && !c.guardRe.test(content)) continue;
    if (c.staleRe.test(content)) out.push(conv);
  }
  return out;
}
