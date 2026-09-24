// src/adapters/hooks/context-data.ts — shared debt + mem context reader
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). Used by both read-hint and
// edit-hint adapters to attach debt/mem lines when a file is open.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { collectSourceFiles, SCAN_EXTS } from "../../analyze/index.js";
import { readTrackDir, sessionKey } from "../../core/hook-helpers.js";
import { clipMemText, readMemLog } from "../../core/mem-log.js";
import { debtForFile, resolveDebtScope } from "../../debt/index.js";
import { movedTargets } from "../../mem/selectors.js";

const DEBT_HINT_MAX = 3;
const MEM_HINT_MAX = 2;

export interface ContextLineData {
  worktree: string;
  debtIds: string[];
  debtLines: string[];
  memLines: string[];
  /** Ids of open bugs actually emitted as OPEN BUG lines above (for the fire log). */
  openBugIds: string[];
  /** Ids of every mem row emitted in memLines (open bugs first) — joined to authors offline. */
  memIds: string[];
}

/** Mem row ids already shown this session — a row repeats on every read/edit otherwise. */
function shownPath(session: string): string {
  return join(readTrackDir(), `${sessionKey(session)}.mem-shown`);
}

function readShown(session: string): Set<string> {
  try {
    const p = shownPath(session);
    if (!existsSync(p)) return new Set();
    return new Set(readFileSync(p, "utf-8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

function markShown(session: string, ids: string[]): void {
  if (ids.length === 0) return;
  try {
    mkdirSync(readTrackDir(), { recursive: true });
    appendFileSync(shownPath(session), `${ids.join("\n")}\n`, "utf-8");
  } catch {
    // a hint must never fail the tool call
  }
}

/**
 * Structured data behind readContextLines — used by cmdHookReadHint for logging.
 * With a session, a non-bug mem row shows once per session (open bugs always
 * show: they are exact files[] matches and the point is to nag until closed).
 */
export function readContextData(
  filePath: unknown,
  cwd: string,
  session?: unknown,
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
    const openBugIds: string[] = [];
    const memIds: string[] = [];

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
      // PLAN-mem-core chunk 5 — follow moves: a row naming old/a.ts still
      // shows when the file now lives at new/a.ts, as long as no other a.ts
      // exists on disk. Missing = stat-miss on the worktree-joined path; the
      // tree walk runs only when some row actually names a missing file.
      const missingOld = new Set<string>();
      for (const r of mem.rows)
        for (const f of r.files ?? [])
          if (f !== rel && !existsSync(join(worktree, f))) missingOld.add(f);
      const moved =
        missingOld.size > 0
          ? movedTargets([...missingOld], collectSourceFiles(worktree))
          : null;
      const filesOf = (r: (typeof mem.rows)[number]): string[] =>
        (r.files ?? []).map((f) => moved?.get(f) ?? f);
      const movedFrom = (r: (typeof mem.rows)[number]): string => {
        const from = (r.files ?? []).find(
          (f) => f !== rel && moved?.get(f) === rel,
        );
        return from ? ` (moved from ${from})` : "";
      };
      // Open bugs first (PLAN-active-pain chunk 3): a kind:"bug" row whose id
      // is in no close row's ref — the same tombstone shape as openRows in
      // src/mem/selectors.ts, never a regex on text. Exact files[] match only:
      // a bug row with no files[] stays silent rather than guessed at.
      const closed = new Set(
        mem.rows.filter((r) => r.kind === "close").map((r) => r.ref),
      );
      const openLines: string[] = [];
      for (const r of mem.rows) {
        if (openLines.length >= MEM_HINT_MAX) break;
        if (r.kind !== "bug" || !r.id || closed.has(r.id)) continue;
        if (!filesOf(r).includes(rel)) continue;
        openLines.push(
          `fapony mem: OPEN BUG ${r.id} — "${clipMemText(r.text)}" — ปิดด้วย fapony mem close ${r.id} "<msg>" เมื่อแก้แล้ว${movedFrom(r)}`,
        );
        openBugIds.push(r.id);
      }
      const base = basename(rel);
      // Tiers: files[] names this file > text/spec mentions the path >
      // basename-only. readMemLog is newest first, so each tier is too.
      const exact: typeof mem.rows = [];
      const mention: typeof mem.rows = [];
      const baseOnly: typeof mem.rows = [];
      for (const r of mem.rows) {
        if (r.kind === "claim" || r.kind === "release" || r.kind === "close") {
          continue;
        }
        if (filesOf(r).includes(rel)) {
          exact.push(r);
          continue;
        }
        const hay = `${r.text}\n${r.spec ?? ""}\n${(r.files ?? []).join(",")}`;
        if (hay.includes(rel)) mention.push(r);
        else if (base && hay.includes(base)) baseOnly.push(r);
      }
      let usableBase = baseOnly;
      if (baseOnly.length > 0) {
        const sameName = collectSourceFiles(worktree).filter(
          (f) => basename(f) === base,
        ).length;
        if (sameName !== 1) usableBase = [];
      }
      const shown =
        typeof session === "string" && session !== ""
          ? readShown(session)
          : null;
      // Open lines take the closed rows' slots first; the rest fills the
      // remaining budget without adding lines past the cap — and without
      // repeating a row already emitted as OPEN BUG or shown this session.
      const emitted = new Set(openBugIds);
      const rest = [exact, mention, usableBase]
        .flat()
        .filter((r) => !(r.id && (emitted.has(r.id) || shown?.has(r.id))))
        .slice(0, MEM_HINT_MAX - openLines.length);
      for (const line of openLines) memLines.push(line);
      memIds.push(...openBugIds);
      const restIds: string[] = [];
      for (const r of rest) {
        if (r.id) restIds.push(r.id);
        memLines.push(
          `fapony mem: ${r.ts.slice(0, 10)} ${r.kind} — ${clipMemText(r.text)}${movedFrom(r)}`,
        );
      }
      memIds.push(...restIds);
      if (shown && typeof session === "string") markShown(session, restIds);
    }
    return { worktree, debtIds, debtLines, memLines, openBugIds, memIds };
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
