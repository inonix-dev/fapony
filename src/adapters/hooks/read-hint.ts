// src/adapters/hooks/read-hint.ts — Read hint + re-read hint + commit hint
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). Attaches size/read context
// to file reads. Also includes commitHintFor (OpenCode commit hint).

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { SCAN_EXTS } from "../../analyze.js";
import { recordHintFire } from "../../core/hint-log.js";
import { sessionKey } from "../../core/hook-helpers.js";
import { readMemLog } from "../../memory.js";
import { renderSeed } from "../../seed/review-seed.js";
import { hasBugMarker, isBugfixCommit } from "./bug-markers.js";
import { readContextData } from "./context-data.js";

// --- Read hint (size) ---

/** Below this size a full read is already cheap — stay silent. */
export const READ_HINT_MIN_BYTES = 24_000;
/** A caller-chosen limit below this is a bounded read — already cheap. */
export const READ_HINT_MIN_LIMIT = 300;
/** One-time measurement (2026-09-17, this repo): 5 files / 2,146 lines ≈ 3.7KB out. */
const READ_HINT_MEASURED = "measured ~3.7KB output on a 2,146-line file";
/** Cap on the outline attached to the read hint — keeps the hint compact. */
const READ_HINT_OUTLINE_CAP = 2_000;

export interface ReadHintInput {
  filePath: unknown;
  offset?: unknown;
  limit?: unknown;
  cwd: string;
}

/**
 * Factual one-liner for a full-file read of a large source file, or null.
 * Every unknown resolves to null — a hint must never fire on a guess.
 */
export function readHintFor(opts: ReadHintInput): string | null {
  try {
    if (typeof opts.filePath !== "string" || opts.filePath === "") return null;
    const dot = opts.filePath.lastIndexOf(".");
    if (dot < 0 || !SCAN_EXTS.has(opts.filePath.slice(dot))) return null;
    const limit = typeof opts.limit === "number" ? opts.limit : null;
    if (limit !== null && limit < READ_HINT_MIN_LIMIT) return null;
    const st = statSync(opts.filePath);
    if (!st.isFile() || st.size < READ_HINT_MIN_BYTES) return null;
    const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (git.exitCode !== 0) return null;
    const lines = readFileSync(opts.filePath, "utf-8").split("\n").length;
    const rel = relative(opts.cwd, opts.filePath);
    const shown = rel.startsWith("..") ? opts.filePath : rel;

    let outline = "";
    try {
      const seed = renderSeed(["--files", shown], opts.cwd);
      const sigMatch = seed.match(
        /signatures \(current\):\n([\s\S]*?)(?:\n\w|\nstatic graph)/,
      );
      if (sigMatch) {
        outline = sigMatch[1].trim();
      } else {
        const afterFiles = seed.indexOf("\nimporters");
        if (afterFiles > 0) {
          outline = seed
            .slice(0, Math.min(afterFiles, READ_HINT_OUTLINE_CAP))
            .trim();
        } else {
          outline = seed.slice(0, READ_HINT_OUTLINE_CAP).trim();
        }
      }
      if (outline.length > READ_HINT_OUTLINE_CAP) {
        outline = `${outline.slice(0, READ_HINT_OUTLINE_CAP).trimEnd()}\n… truncated`;
      }
    } catch {
      // review-seed failed — fall back to the command suggestion
    }

    if (outline) {
      return (
        `fapony: ${shown} is ${lines} lines\n${outline}\n` +
        `(review-seed --files ${shown} for importers + callers; skill /lookup-before-edit)`
      );
    }
    return (
      `fapony: ${shown} is ${lines} lines — review-seed --files ${shown} ` +
      `returns exports with line numbers, importers, and signatures first ` +
      `(${READ_HINT_MEASURED}; skill /lookup-before-edit has the routine)`
    );
  } catch {
    return null;
  }
}

// --- Re-read tracking (mtime heuristic) ---

const READ_TRACK_DIR = "read-track";

export interface ReadTrackRow {
  ts: string;
  path: string;
  mtime: number;
}

/** Directory holding one read log per session. */
function readTrackDir(): string {
  const base =
    process.env.FAPONY_STATE_DIR || join(homedir(), ".config", "fapony");
  return join(base, READ_TRACK_DIR);
}

/** Absolute path of a session's read log — may not exist. */
export function readTrackPath(session: string): string {
  return join(readTrackDir(), `${sessionKey(session)}.jsonl`);
}

function readTrackRows(session: string): ReadTrackRow[] {
  const p = readTrackPath(session);
  if (!existsSync(p)) return [];
  const rows: ReadTrackRow[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as ReadTrackRow;
      if (typeof r.path === "string" && typeof r.mtime === "number") {
        rows.push(r);
      }
    } catch {
      // a torn line must not lose the rest of the log
    }
  }
  return rows;
}

function appendReadTrackRow(session: string, row: ReadTrackRow): void {
  const dir = readTrackDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(readTrackPath(session), `${JSON.stringify(row)}\n`, "utf-8");
}

export interface RereadHintInput {
  filePath: unknown;
  offset?: unknown;
  limit?: unknown;
  cwd: string;
  session?: unknown;
}

/**
 * Annotate a full-file read of a path already read this session whose mtime
 * has not moved, or null. Records every full read.
 */
export function rereadHintFor(opts: RereadHintInput): string | null {
  try {
    if (process.env.FAPONY_NO_REREAD_HINT === "1") return null;
    if (typeof opts.session !== "string" || opts.session === "") return null;
    if (typeof opts.filePath !== "string" || opts.filePath === "") return null;
    const offset = typeof opts.offset === "number" ? opts.offset : null;
    if (offset !== null && offset !== 0) return null;
    const limit = typeof opts.limit === "number" ? opts.limit : null;
    if (limit !== null && limit < READ_HINT_MIN_LIMIT) return null;

    const abs = (() => {
      const p = opts.filePath.startsWith("/")
        ? opts.filePath
        : join(opts.cwd, opts.filePath);
      try {
        return realpathSync(p);
      } catch {
        return resolve(p);
      }
    })();
    const st = statSync(abs);
    if (!st.isFile()) return null;
    const mtime = Math.round(st.mtimeMs);

    const prior = readTrackRows(opts.session).filter((r) => r.path === abs);
    const last = prior.at(-1);
    appendReadTrackRow(opts.session, {
      ts: new Date().toISOString(),
      path: abs,
      mtime,
    });
    if (!last || last.mtime !== mtime) return null;

    const rel = relative(opts.cwd, opts.filePath);
    const shown = rel.startsWith("..") ? opts.filePath : rel;
    return (
      `fapony: already read ${shown} ${prior.length}\u00d7 this session — ` +
      `content unchanged since the last read (mtime), grep the line range ` +
      `you need instead of re-reading it`
    );
  } catch {
    return null;
  }
}

// --- Commit hint (OpenCode tool.execute.after) ---

/** Below this number of commits, the hint is unnecessary noise. */
export const COMMIT_HINT_MIN_COMMITS = 1;

export interface CommitHintInput {
  command: unknown;
  cwd: string;
}

function git(args: string[], cwd: string): string | null {
  try {
    const p = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

import { hookTsMs, utcStamp } from "../../core/hook-helpers.js";

/**
 * Nudge for bash commands containing `git commit` that produced commits with
 * no mem row recorded for them.
 */
export function commitHintFor(opts: CommitHintInput): string | null {
  try {
    if (typeof opts.command !== "string" || opts.command === "") return null;
    if (!/\bgit\s+commit\b/.test(opts.command)) return null;

    const worktree = git(["rev-parse", "--show-toplevel"], opts.cwd);
    if (!worktree) return null;

    let memLastTs: string | null = null;
    try {
      // Anchor at the dir the commit ran in, not the repo root: the log is
      // app-scoped in a monorepo, and root resolution misses it (bug muc9q47r).
      memLastTs = readMemLog(opts.cwd).rows[0]?.ts ?? null;
    } catch {
      memLastTs = null;
    }
    if (!memLastTs) return null;
    const since = utcStamp(new Date(hookTsMs(memLastTs) + 1000));

    const log = git(
      ["log", "--since", `${since} +0000`, "--format=%h %s"],
      worktree,
    );
    const commitList = log ? log.split("\n").filter(Boolean) : [];
    if (commitList.length < COMMIT_HINT_MIN_COMMITS) return null;

    // %h %s — strip the short hash to test the subject alone.
    const subjectOf = (c: string) => c.replace(/^\S+\s+/, "");
    const bugCommits = commitList.filter(
      (c) =>
        isBugfixCommit(subjectOf(c)) || hasBugMarker(subjectOf(c)) !== null,
    );

    const lines: string[] = [
      `${commitList.length} commit(s) since last mem row (${memLastTs.slice(0, 10)}) — record a mem row for this work.`,
    ];
    for (const c of commitList.slice(0, 5)) lines.push(`  ${c}`);
    if (commitList.length > 5) lines.push(`  … +${commitList.length - 5} more`);
    lines.push(
      `fapony mem add <decision|bug|note> "what happened" --files <files> ${worktree}/.fapony/plan/PLAN.md`,
    );
    if (bugCommits.length > 0) {
      lines.push(
        `${bugCommits.length} of these read as a bug (fix-type commit or found-a-bug wording) — use kind:bug so it surfaces later, not note:`,
      );
      lines.push(`  fapony mem add bug "what broke" --files <files>`);
    }

    const prefixed = lines.map((l) => `fapony: ${l}`).join("\n");
    return prefixed;
  } catch {
    return null;
  }
}

// --- Read hint CLI command ---

/** Claude Code PreToolUse (matcher Read): stdin JSON in, additionalContext out. */
export async function cmdHookReadHint(): Promise<void> {
  try {
    const raw = JSON.parse(await Bun.stdin.text()) as {
      cwd?: string;
      transcript_path?: string;
      session_id?: string;
      tool_input?: {
        file_path?: unknown;
        offset?: unknown;
        limit?: unknown;
      };
    };
    const cwd = raw.cwd ?? process.cwd();
    const filePath = raw.tool_input?.file_path;
    const session = raw.transcript_path ?? raw.session_id;
    const parts: string[] = [];
    const hint = readHintFor({
      filePath,
      offset: raw.tool_input?.offset,
      limit: raw.tool_input?.limit,
      cwd,
    });
    if (hint) parts.push(hint);
    const reread = rereadHintFor({
      filePath,
      offset: raw.tool_input?.offset,
      limit: raw.tool_input?.limit,
      cwd,
      session,
    });
    if (reread) parts.push(reread);
    const ctx = readContextData(filePath, cwd);
    if (ctx) {
      for (const line of [...ctx.debtLines, ...ctx.memLines]) {
        parts.push(line);
      }
    }
    if (parts.length > 0) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: parts.join("\n"),
          },
        }),
      );
    }

    // --- hint-fire log ---
    const rel =
      typeof filePath === "string"
        ? (() => {
            try {
              const git = Bun.spawnSync(
                ["git", "rev-parse", "--show-toplevel"],
                { cwd, stdout: "pipe", stderr: "pipe" },
              );
              if (git.exitCode !== 0) return null;
              const wt = realpathSync(git.stdout.toString().trim());
              const abs = realpathSync(
                filePath.startsWith("/") ? filePath : join(wt, filePath),
              );
              const r = relative(wt, abs).split("\\").join("/");
              return r.startsWith("..") ? null : r;
            } catch {
              return null;
            }
          })()
        : null;
    const worktree = ctx?.worktree ?? null;
    if (worktree) {
      if (hint) {
        recordHintFire({
          ts: new Date().toISOString(),
          worktree,
          surface: "read",
          file: rel,
          count: 1,
        });
      }
      if (ctx && ctx.debtIds.length > 0) {
        recordHintFire({
          ts: new Date().toISOString(),
          worktree,
          surface: "debt",
          file: rel,
          count: ctx.debtIds.length,
          ids: ctx.debtIds,
        });
      }
      if (ctx && ctx.memLines.length > 0) {
        recordHintFire({
          ts: new Date().toISOString(),
          worktree,
          surface: "mem",
          file: rel,
          count: ctx.memLines.length,
        });
      }
    }
  } catch {
    // any failure = no hint; a hook must never block a read over a hint
  }
}
