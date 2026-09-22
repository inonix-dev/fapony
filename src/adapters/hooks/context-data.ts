// src/adapters/hooks/context-data.ts — shared debt + mem context reader
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). Used by both read-hint and
// edit-hint adapters to attach debt/mem lines when a file is open.

import { realpathSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { collectSourceFiles, SCAN_EXTS } from "../../analyze.js";
import { debtForFile, loadConventions } from "../../debt/index.js";
import { readMemLog } from "../../memory.js";

const DEBT_HINT_MAX = 3;
const MEM_HINT_MAX = 2;
const MEM_TEXT_MAX = 120;

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

    // convention debt — source files only, fresh from the repo
    const dot = rel.lastIndexOf(".");
    if (dot >= 0 && SCAN_EXTS.has(rel.slice(dot))) {
      for (const c of debtForFile(
        worktree,
        abs,
        loadConventions(worktree),
      ).slice(0, DEBT_HINT_MAX)) {
        debtIds.push(c.id);
        debtLines.push(`fapony debt: [${c.id}] ${c.rule}`);
      }
    }

    // mem rows that are about this file
    const mem = readMemLog(worktree);
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
