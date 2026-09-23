// src/adapters/hooks/context-data.ts — shared debt + mem context reader
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). Used by both read-hint and
// edit-hint adapters to attach debt/mem lines when a file is open.

import { realpathSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { collectSourceFiles, SCAN_EXTS } from "../../analyze.js";
import { MEM_TEXT_MAX, readMemLog } from "../../core/mem-log.js";
import { debtForFile, resolveDebtScope } from "../../debt/index.js";

const DEBT_HINT_MAX = 3;
const MEM_HINT_MAX = 2;

export interface ContextLineData {
  worktree: string;
  debtIds: string[];
  debtLines: string[];
  memLines: string[];
}

/** Structured data behind readContextLines — used by cmdHookReadHint for logging. */
export function readContextData(
  filePath: unknown,
  cwd: string,
): ContextLineData | null {
  try {
    if (typeof filePath !== "string" || filePath === "") return null;
    const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (git.exitCode !== 0) return null;
    const worktree = realpathSync(git.stdout.toString().trim());
    const abs = realpathSync(
      filePath.startsWith("/") ? filePath : join(worktree, filePath),
    );
    const rel = relative(worktree, abs).split("\\").join("/");
    if (rel.startsWith("..") || rel === "") return null;

    const debtIds: string[] = [];
    const debtLines: string[] = [];
    const memLines: string[] = [];

    // convention debt — source files only, fresh from the repo. The scope
    // pairs the git root (repo-relative `where`) with the nearest
    // conventions file — anchoring the load at the root goes silent in a
    // monorepo with app-scoped conventions (bug mucvfaxk).
    const dot = rel.lastIndexOf(".");
    if (dot >= 0 && SCAN_EXTS.has(rel.slice(dot))) {
      const scope = resolveDebtScope(dirname(abs));
      for (const c of debtForFile(scope.scanRoot, abs, scope.loaded).slice(
        0,
        DEBT_HINT_MAX,
      )) {
        debtIds.push(c.id);
        debtLines.push(`fapony debt: [${c.id}] ${c.rule}`);
      }
    }

    // mem rows that are about this file — resolve the log from the file's own
    // directory, not the repo root. In a monorepo the log is app-scoped, so
    // anchoring at the root sees only an out-of-scope candidate and goes silent
    // even though the file being touched sits right under its log (bug muc9q47r).
    const mem = readMemLog(dirname(abs));
    if (mem.rows.length > 0) {
      const base = basename(rel);
      const direct: typeof mem.rows = [];
      const baseOnly: typeof mem.rows = [];
      for (const r of mem.rows) {
        if (r.kind === "claim" || r.kind === "release") continue;
        const hay = `${r.text}\n${r.spec ?? ""}\n${(r.files ?? []).join(",")}`;
        if ((r.files ?? []).includes(rel) || hay.includes(rel)) {
          direct.push(r);
          continue;
        }
        if (base && hay.includes(base)) baseOnly.push(r);
      }
      let usableBase = baseOnly;
      if (baseOnly.length > 0) {
        const sameName = collectSourceFiles(worktree).filter(
          (f) => basename(f) === base,
        ).length;
        if (sameName !== 1) usableBase = [];
      }
      const memHits = [...direct, ...usableBase].slice(0, MEM_HINT_MAX);
      for (const r of memHits) {
        memLines.push(
          `fapony mem: ${r.ts.slice(0, 10)} ${r.kind} — ${r.text.slice(0, MEM_TEXT_MAX)}`,
        );
      }
    }
    return { worktree, debtIds, debtLines, memLines };
  } catch {
    return null;
  }
}

export function readContextLines(filePath: unknown, cwd: string): string[] {
  const data = readContextData(filePath, cwd);
  if (!data) return [];
  return [...data.debtLines, ...data.memLines].slice(
    0,
    DEBT_HINT_MAX + MEM_HINT_MAX,
  );
}
