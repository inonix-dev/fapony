// src/adapters/hooks/edit-hint.ts — Edit hint: importer count + once-per-session dedupe
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). Attaches importer count
// when editing a source file.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { buildGraphCached, SCAN_EXTS } from "../../analyze.js";
import { recordHintFire } from "../../core/hint-log.js";
import { sessionKey } from "../../core/hook-helpers.js";
import { readContextData } from "./context-data.js";

const EDIT_TRACK_DIR = "edit-track";

export interface EditTrackRow {
  ts: string;
  path: string;
}

/** Directory holding one edit log per session. */
function editTrackDir(): string {
  const base =
    process.env.FAPONY_STATE_DIR || join(homedir(), ".config", "fapony");
  return join(base, EDIT_TRACK_DIR);
}

/** Absolute path of a session's edit log — may not exist. */
export function editTrackPath(session: string): string {
  return join(editTrackDir(), `${sessionKey(session)}.jsonl`);
}

function editTrackPaths(session: string): Set<string> {
  const p = editTrackPath(session);
  if (!existsSync(p)) return new Set();
  const out = new Set<string>();
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as EditTrackRow;
      if (typeof r.path === "string") out.add(r.path);
    } catch {
      // a torn line must not lose the rest of the log
    }
  }
  return out;
}

function appendEditTrackRow(session: string, row: EditTrackRow): void {
  const dir = editTrackDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(editTrackPath(session), `${JSON.stringify(row)}\n`, "utf-8");
}

export interface EditHintInput {
  filePath: unknown;
  cwd: string;
  session?: unknown;
}

/**
 * Factual one-liner for editing a source file that has importers, or null.
 * Every unknown resolves to null — a hint must never fire on a guess.
 */
export function editHintFor(opts: EditHintInput): string | null {
  try {
    if (typeof opts.filePath !== "string" || opts.filePath === "") return null;
    const dot = opts.filePath.lastIndexOf(".");
    if (dot < 0 || !SCAN_EXTS.has(opts.filePath.slice(dot))) return null;
    const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (git.exitCode !== 0) return null;
    const worktree = realpathSync(git.stdout.toString().trim());
    const abs = (() => {
      const p = opts.filePath.startsWith("/")
        ? opts.filePath
        : join(opts.cwd, opts.filePath);
      try {
        return realpathSync(p);
      } catch {
        return null;
      }
    })();
    if (!abs) return null;
    const rel = relative(worktree, abs).split(sep).join("/");
    if (rel.startsWith("..") || rel === "") return null;

    const importers = buildGraphCached(worktree).dependents.get(rel);
    if (!importers || importers.size === 0) return null;

    if (typeof opts.session === "string" && opts.session !== "") {
      if (editTrackPaths(opts.session).has(abs)) return null;
      appendEditTrackRow(opts.session, {
        ts: new Date().toISOString(),
        path: abs,
      });
    }

    const n = importers.size;
    return (
      `fapony: ${rel} has ${n} importer${n === 1 ? "" : "s"} — ` +
      `review-seed --files ${rel} lists them (add --callers <export> for one ` +
      `export's callers); check before changing its shape (skill /lookup-before-edit)`
    );
  } catch {
    return null;
  }
}

/** Claude Code PreToolUse (matcher Edit): stdin JSON in, additionalContext out. */
export async function cmdHookEditHint(): Promise<void> {
  try {
    const raw = JSON.parse(await Bun.stdin.text()) as {
      cwd?: string;
      transcript_path?: string;
      session_id?: string;
      tool_input?: {
        file_path?: unknown;
      };
    };
    const cwd = raw.cwd ?? process.cwd();
    const filePath = raw.tool_input?.file_path;
    const session = raw.transcript_path ?? raw.session_id;
    const parts: string[] = [];
    const hint = editHintFor({ filePath, cwd, session });
    if (hint) parts.push(hint);
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
    if (hint) {
      try {
        const g = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (g.exitCode === 0) {
          const worktree = realpathSync(g.stdout.toString().trim());
          const abs =
            typeof filePath === "string"
              ? (() => {
                  try {
                    return realpathSync(
                      filePath.startsWith("/")
                        ? filePath
                        : join(worktree, filePath),
                    );
                  } catch {
                    return null;
                  }
                })()
              : null;
          const rel = abs
            ? relative(worktree, abs).split("\\").join("/")
            : null;
          recordHintFire({
            ts: new Date().toISOString(),
            worktree,
            surface: "edit",
            file: rel && !rel.startsWith("..") ? rel : null,
            count: 1,
          });
          if (ctx && ctx.openBugIds.length > 0) {
            recordHintFire({
              ts: new Date().toISOString(),
              worktree,
              surface: "open-bug",
              file: rel && !rel.startsWith("..") ? rel : null,
              count: ctx.openBugIds.length,
              ids: ctx.openBugIds,
            });
          }
        }
      } catch {
        // best-effort — swallow
      }
    }
  } catch {
    // any failure = no hint; a hook must never block an edit over a hint
  }
}
