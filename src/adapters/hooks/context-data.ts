// src/adapters/hooks/context-data.ts — convention-debt lines for a file being
// edited. Per-file memory moved to fael (its read/edit hooks push rows).

import { realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { SCAN_EXTS } from "../../analyze/index.js";
import { debtForFile, resolveDebtScope } from "../../debt/index.js";

const DEBT_HINT_MAX = 3;

export interface ContextLineData {
  worktree: string;
  debtIds: string[];
  debtLines: string[];
}

/** Debt lines for filePath (source files inside a git repo), or null. */
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
    // The scope pairs the git root (repo-relative `where`) with the nearest
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
    return { worktree, debtIds, debtLines };
  } catch {
    return null;
  }
}
