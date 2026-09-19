// src/hook.ts — Claude Code / Cursor Stop hook: refuse to end a turn that produced
// commits but no verdict.
//
// Why a hook and not a message: SERVER_INSTRUCTIONS is a *request* that the
// agent remember, and it measured as not enough · the hook does not grade in
// the agent's place (it cannot — it does not see whether the work passed or
// broke) it merely won't let the turn end until the agent grades itself,
// separating "who judges" from "who forces judgment"
//
// The signal is a commit, not a dirty tree — dirty = still working, commit =
// the unit of work is done, matching the definition "1 run = 1 measurable
// unit of work" (rule 7)
//
// Two payloads, one decision — field-mapping only:
//   claude  {cwd, transcript_path, stop_hook_active} → {"decision":"block"}
//   cursor  {workspace_roots, conversation_id, loop_count, status} → {"followup_message"}
//   (cursor: loop_count ≥ 1 = the hook already fired, status ≠ completed = allow)

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { collectSourceFiles, SCAN_EXTS } from "./analyze.js";
import { openDb } from "./db/index.js";
import { debtForFile, loadConventions } from "./debt.js";
import { readMemLog } from "./memory.js";

// --- Hint-fire log (PLAN-feedback-surface chunk 1) ---
//
// Append-only JSONL under state dir (<faponyDir>/hint-log/<key>.jsonl),
// one file per worktree. Best-effort: every error swallowed — a hook that
// cannot log must still annotate. Called at caller only (cmdHookReadHint +
// opencode plugins), never inside readHintFor/readContextLines/commitHintFor
// (test pollution: those functions are called ~20x in test/hook.test.ts
// without setting FAPONY_STATE_DIR).

const HINT_LOG_DIR = "hint-log";

/** Stable filename key from an absolute worktree path. */
export function worktreeKey(worktree: string): string {
  return worktree.replace(/^\/+/, "").replace(/\//g, "--");
}

/** Directory holding one hint-fire log file per worktree. */
function hintLogDir(): string {
  const base =
    process.env.FAPONY_STATE_DIR || join(homedir(), ".config", "fapony");
  return join(base, HINT_LOG_DIR);
}

/** Absolute path of a worktree's hint-fire log — may not exist. */
export function hintLogPath(worktree: string): string {
  return join(hintLogDir(), `${worktreeKey(worktree)}.jsonl`);
}

export interface HintFireRow {
  ts: string;
  worktree: string;
  surface: "read" | "debt" | "mem" | "commit";
  file: string | null;
  count: number;
  ids?: string[];
}

/**
 * Append a hint-fire log row. Best-effort: never throws, never blocks.
 * Uses $FAPONY_STATE_DIR when set (tests, CI), otherwise ~/.config/fapony.
 */
export function recordHintFire(row: HintFireRow): void {
  try {
    const dir = hintLogDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(
      hintLogPath(row.worktree),
      `${JSON.stringify(row)}\n`,
      "utf-8",
    );
  } catch {
    // best-effort — swallow
  }
}

// --- Debt precision (PLAN-feedback-surface chunk 2) ---
//
// Reads the hint-fire log, re-runs debtForFile at HEAD for each file that
// received debt hints, and counts which ids are no longer flagged. This is
// deterministic (no proxy, no join with events) and answers: of the debt
// lines fapony showed, how many is the repo now clean of?

export interface HintImpact {
  fired: number;
  by_surface: { read: number; debt: number; mem: number; commit: number };
  debt: { shown: number; resolved: number; unknown: number };
  window: string | null;
}

/**
 * Compute hint-fire impact from the log. `since` is an ISO date string;
 * omit to scan all rows. `worktree` scopes to one project's log file (the
 * `<key>.jsonl` naming makes this a filename comparison) — omit to merge
 * every worktree. Returns zeroed counts (not null) when there are no rows —
 * the caller decides how to present "no data" vs "zero".
 */
export function computeHintImpact(
  since?: string,
  worktree?: string,
): HintImpact {
  const dir = hintLogDir();
  const impact: HintImpact = {
    fired: 0,
    by_surface: { read: 0, debt: 0, mem: 0, commit: 0 },
    debt: { shown: 0, resolved: 0, unknown: 0 },
    window: since ?? null,
  };

  if (!existsSync(dir)) return impact;

  // Read the worktree's .jsonl when scoped, else every file in the dir.
  let files: string[];
  try {
    const all = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    files = worktree
      ? all.filter((f) => f === `${worktreeKey(worktree)}.jsonl`)
      : all;
  } catch {
    return impact;
  }

  // debtShown: Map<"worktree\tfile\tid", true> — unique debt ids per file.
  const debtShown = new Map<string, true>();
  // debtByFile: Map<"worktree\tfile", string[]> — all ids shown per file.
  const debtByFile = new Map<string, string[]>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line) continue;
      let row: HintFireRow;
      try {
        row = JSON.parse(line) as HintFireRow;
      } catch {
        continue;
      }
      if (since && row.ts < since) continue;
      impact.fired++;
      impact.by_surface[row.surface]++;

      if (row.surface === "debt" && row.ids && row.file) {
        const key = `${row.worktree}\t${row.file}`;
        const existing = debtByFile.get(key) ?? [];
        for (const id of row.ids) {
          const dk = `${row.worktree}\t${row.file}\t${id}`;
          if (!debtShown.has(dk)) {
            debtShown.set(dk, true);
            existing.push(id);
          }
        }
        debtByFile.set(key, existing);
      }
    }
  }

  // Re-run debtForFile at HEAD for each file that had debt hints.
  for (const [key, ids] of debtByFile) {
    const [worktree, file] = key.split("\t");
    const absFile = join(worktree, file);
    let currentIds: Set<string>;
    try {
      if (!statSync(absFile).isFile()) {
        // File deleted — all its debt ids are unknown.
        impact.debt.unknown += ids.length;
        continue;
      }
      const convs = debtForFile(worktree, absFile, loadConventions(worktree));
      currentIds = new Set(convs.map((c) => c.id));
    } catch {
      impact.debt.unknown += ids.length;
      continue;
    }
    for (const id of ids) {
      impact.debt.shown++;
      if (currentIds.has(id)) {
        // still present — not resolved
      } else {
        impact.debt.resolved++;
      }
    }
  }

  return impact;
}

export interface RawStopPayload {
  // Claude Code
  cwd?: string;
  transcript_path?: string | null;
  stop_hook_active?: boolean;
  // Cursor — common schema (https://cursor.com/docs/agent/hooks)
  workspace_roots?: string[];
  conversation_id?: string;
  loop_count?: number;
  status?: string;
}

export type StopClient = "claude" | "cursor";

export interface NormalizedStopInput {
  client: StopClient;
  cwd: string;
  transcriptPath: string | null;
  stopHookActive: boolean;
}

/** UTC 'YYYY-MM-DD HH:MM:SS' — the format events.ts is written in. */
export function utcStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Pure decision: block only when this session produced commits and none of
 * them got graded. Every unknown (no git, no transcript, hook already fired)
 * resolves to "allow" — a hook that guesses wrong must never trap the agent.
 *
 * PLAN-mem-mcp chunk 3: the block message now carries the commit list and the
 * mem-log status (last row date). Both are *information*, never conditions —
 * the block condition stays verdict-only (rule 7: the hook does not judge, it
 * reports what is pending so the agent decides what deserves recording).
 */
export function decideStop(opts: {
  stopHookActive: boolean;
  worktree: string | null;
  commits: number;
  verdicts: number;
  commitList?: string[];
  memLastTs?: string | null;
}): string | null {
  if (opts.stopHookActive) return null; // already blocked once — let it end
  if (!opts.worktree) return null;
  if (opts.commits < 1) return null;
  if (opts.verdicts > 0) return null;

  const lines: string[] = [
    `${opts.commits} commit(s) landed in ${opts.worktree} this session with no verdict filed.`,
  ];
  // ≤ 5 commits listed, rest folded into "… +N more" (spec §6: ≤ 12 lines).
  const list = opts.commitList ?? [];
  for (const c of list.slice(0, 5)) lines.push(`  ${c}`);
  if (list.length > 5) lines.push(`  … +${list.length - 5} more`);
  if (opts.memLastTs) {
    lines.push(
      `mem: last row ${opts.memLastTs.slice(0, 10)} — nothing newer this session`,
    );
  } else {
    lines.push("mem: no rows at all — nothing recorded in this project yet");
  }
  lines.push(
    `Call verdict_submit before ending: worktree must be the absolute path above, ` +
      `regime is one of code|fix|review|plan|inquiry|test, and the note must stand alone ` +
      `(it is read months from now with no access to this conversation). ` +
      `Grade what actually happened — pass-family when it held up, fail if the first ` +
      `attempt was wrong, uncertain when you could not verify it. What deserves a mem ` +
      `row (decision/bug/note) is your call — not every unit needs one.`,
  );
  return lines.join("\n");
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

/**
 * Cursor transcript location derived from the conversation id —
 * ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl where slug is
 * the workspace path minus its leading "/", "/" → "-" (Claude Code's slug
 * convention). Fallback only: a real transcript_path in the payload wins.
 */
export function cursorTranscriptPath(
  home: string,
  cwd: string,
  conversationId: string,
): string {
  const slug = cwd.replace(/^\//, "").replace(/\//g, "-");
  return join(
    home,
    ".cursor",
    "projects",
    slug,
    "agent-transcripts",
    conversationId,
    `${conversationId}.jsonl`,
  );
}

export function isCursorPayload(raw: RawStopPayload): boolean {
  return (
    Array.isArray(raw.workspace_roots) ||
    typeof raw.conversation_id === "string"
  );
}

/** Field-mapping only — both clients feed the same decideStop below. */
export function normalizeStopInput(
  raw: RawStopPayload,
  home: string,
): NormalizedStopInput {
  if (isCursorPayload(raw)) {
    const cwd = raw.workspace_roots?.[0] ?? raw.cwd ?? process.cwd();
    let transcriptPath =
      typeof raw.transcript_path === "string" && raw.transcript_path
        ? raw.transcript_path
        : null;
    if (!transcriptPath && raw.conversation_id) {
      transcriptPath = cursorTranscriptPath(home, cwd, raw.conversation_id);
    }
    return {
      client: "cursor",
      cwd,
      transcriptPath,
      // loop_count counts follow-ups this hook already triggered — ≥ 1 means
      // we already blocked once (Cursor's stop_hook_active).
      stopHookActive: (raw.loop_count ?? 0) > 0,
    };
  }
  return {
    client: "claude",
    cwd: raw.cwd ?? process.cwd(),
    transcriptPath: raw.transcript_path ?? null,
    stopHookActive: raw.stop_hook_active === true,
  };
}

/** Claude blocks with decision:block; Cursor's stop hook "blocks" by
 *  auto-submitting the reason as the next user message. */
export function stopOutput(client: StopClient, reason: string): string {
  return client === "cursor"
    ? JSON.stringify({ followup_message: reason })
    : JSON.stringify({ decision: "block", reason });
}

/** Reads the Stop-hook JSON on stdin, prints a block decision or nothing. */
export async function cmdHookStop(): Promise<void> {
  let reason: string | null = null;
  let client: StopClient = "claude";
  try {
    const raw = JSON.parse(await Bun.stdin.text()) as RawStopPayload;
    const norm = normalizeStopInput(raw, homedir());
    client = norm.client;
    // Cursor aborted/errored turns pass: the user said stop, or the loop
    // died — commits from those turns are still caught at the next completed
    // stop (the window is the conversation transcript's birthtime).
    if (client === "cursor" && raw.status !== "completed") return;

    const worktree = git(["rev-parse", "--show-toplevel"], norm.cwd);

    // Session start = when the transcript file was created. No transcript,
    // no window to measure — allow.
    let since: string | null = null;
    if (norm.transcriptPath) {
      try {
        since = utcStamp(statSync(norm.transcriptPath).birthtime);
      } catch {
        since = null;
      }
    }

    let commits = 0;
    let commitList: string[] = [];
    let verdicts = 0;
    let memLastTs: string | null = null;
    if (worktree && since) {
      const log = git(
        ["log", "--since", `${since} +0000`, "--format=%h %s"],
        norm.cwd,
      );
      commitList = log ? log.split("\n").filter(Boolean) : [];
      commits = commitList.length;
      if (commits > 0) {
        const db = openDb();
        const row = db
          .query(
            `SELECT COUNT(*) AS n FROM events e JOIN runs r ON r.id = e.run_id
             WHERE e.kind = 'gate' AND r.worktree = ? AND e.ts >= ?`,
          )
          .get(worktree, since) as { n: number } | null;
        verdicts = row?.n ?? 0;
        // Informational only — read-only, degrade silently (mem status never
        // becomes a block condition, rule 7).
        try {
          const mem = readMemLog(worktree);
          memLastTs = mem.rows[0]?.ts ?? null;
        } catch {
          memLastTs = null;
        }
      }
    }

    reason = decideStop({
      stopHookActive: norm.stopHookActive,
      worktree: since ? worktree : null,
      commits,
      verdicts,
      commitList,
      memLastTs,
    });
  } catch {
    reason = null; // any failure = allow the turn to end
  }

  if (reason) console.log(stopOutput(client, reason));
}

// --- Read hint (PreToolUse annotate — never block, never dedupe) ---
//
// Reading a large file in full is where an agent spends tokens without
// noticing — warnings in a skill were never enough (same principle as the
// Stop hook: speak while it is spending). But this hook **annotates only**:
// no permissionDecision, no "already read" dedupe — context compaction makes
// "already read" false, and a hook that guesses wrong and traps the agent is
// worse than no hook (the rule from the original hook.ts) — annotate cannot
// trap by construction, the worst cost of a miss is one unnecessary line
//
// The text is facts only (line count + command + a one-time measurement), not
// a per-file estimate — guessing tokens is dressing up as data, against
// "facts only"

/** Below this size a full read is already cheap — stay silent. */
export const READ_HINT_MIN_BYTES = 24_000;
/** A caller-chosen limit below this is a bounded read — already cheap. */
export const READ_HINT_MIN_LIMIT = 300;
/** One-time measurement (2026-09-17, this repo): 5 files / 2,146 lines ≈ 3.7KB out. */
const READ_HINT_MEASURED = "measured ~3.7KB output on a 2,146-line file";

export interface ReadHintInput {
  filePath: unknown;
  offset?: unknown;
  limit?: unknown;
  cwd: string;
}

/**
 * Factual one-liner for a full-file read of a large source file, or null.
 * Every unknown (no path, non-source ext, small file, bounded read, no git
 * repo, stat/read failure) resolves to null — a hint must never fire on a
 * guess. Fast path is statSync only; the file is read just to count lines,
 * and only after the size threshold passed.
 */
export function readHintFor(opts: ReadHintInput): string | null {
  try {
    if (typeof opts.filePath !== "string" || opts.filePath === "") return null;
    const dot = opts.filePath.lastIndexOf(".");
    // SCAN_EXTS keys carry the dot (".ts") — slice from the dot itself.
    if (dot < 0 || !SCAN_EXTS.has(opts.filePath.slice(dot))) return null;
    const limit = typeof opts.limit === "number" ? opts.limit : null;
    if (limit !== null && limit < READ_HINT_MIN_LIMIT) return null;
    const st = statSync(opts.filePath);
    if (!st.isFile() || st.size < READ_HINT_MIN_BYTES) return null;
    // review-seed is a git command — outside a repo the hint would lie.
    const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (git.exitCode !== 0) return null;
    const lines = readFileSync(opts.filePath, "utf-8").split("\n").length;
    // The hint feeds a command line — inside the worktree show the clean
    // relative path, outside it relative() climbs dots, show absolute.
    const rel = relative(opts.cwd, opts.filePath);
    const shown = rel.startsWith("..") ? opts.filePath : rel;
    return (
      `fapony: ${shown} is ${lines} lines — review-seed --files ${shown} ` +
      `returns exports with line numbers, importers, and signatures first ` +
      `(${READ_HINT_MEASURED})`
    );
  } catch {
    return null;
  }
}

// --- Commit hint (tool.execute.after — annotate only, never block) ---
//
// OpenCode has no Stop hook (Cursor does — see cursor.ts hook-stop wiring)
// so it cannot block a turn; instead it appends an annotate to the bash tool
// output whenever there is a git commit with no verdict pending. It is the
// same kind of nudge as the read hint: no block, no dedupe, every unknown →
// silent · called from the opencode plugin by direct import (like
// readHintFor), no CLI subcommand because no client needs it as a subprocess
// (Cursor uses its own hook-stop instead)
//
// The text is facts only (commit list + verdict status), not an estimate

/** Below this number of commits, the hint is unnecessary noise. */
export const COMMIT_HINT_MIN_COMMITS = 1;
/** Cap commits shown in the hint message. */
const COMMIT_HINT_MAX_LIST = 5;

export interface CommitHintInput {
  command: unknown;
  cwd: string;
}

/**
 * Nudge for bash commands containing `git commit` that produced
 * ungraded commits. Returns a one-to-two line hint string, or null
 * when there is nothing to nudge about (already graded, no commits,
 * not a git commit command, not a git repo, any failure).
 *
 * Every unknown resolves to null — a hint must never fire on a
 * guess. The work is cheap: one git rev-parse + one git log + one
 * SQLite count.
 */
export function commitHintFor(opts: CommitHintInput): string | null {
  try {
    if (typeof opts.command !== "string" || opts.command === "") return null;
    // Only fire on git commit commands — not `git push`, `git pull`, etc.
    if (!/\bgit\s+commit\b/.test(opts.command)) return null;

    const worktree = git(["rev-parse", "--show-toplevel"], opts.cwd);
    if (!worktree) return null;

    // Window = commits since the worktree's last verdict, not "does a
    // verdict exist anywhere in its history" — a worktree that earned one
    // verdict months ago must still nudge on every commit made since, the
    // same way cmdHookStop windows on `e.ts >= since` (session start) rather
    // than "any verdict this worktree has ever had".
    const db = openDb();
    const lastVerdict = db
      .query(
        `SELECT MAX(e.ts) AS ts FROM events e JOIN runs r ON r.id = e.run_id
         WHERE e.kind = 'gate' AND r.worktree = ?`,
      )
      .get(worktree) as { ts: string | null } | null;
    // git's --since is inclusive to the second, and the commit a verdict
    // just graded often lands in the same UTC second as the verdict itself
    // (verdict_submit runs right after the commit) — bump by 1s so that
    // commit isn't re-flagged as ungraded because of its own grade.
    const since = lastVerdict?.ts
      ? utcStamp(
          new Date(
            new Date(`${lastVerdict.ts.replace(" ", "T")}Z`).getTime() + 1000,
          ),
        )
      : null;

    const log = since
      ? git(["log", "--since", `${since} +0000`, "--format=%h %s"], worktree)
      : git(["log", "--format=%h %s"], worktree);
    const commitList = log ? log.split("\n").filter(Boolean) : [];
    if (commitList.length < COMMIT_HINT_MIN_COMMITS) return null;

    const reason = decideStop({
      stopHookActive: false, // annotate-only: never "already blocked"
      worktree,
      commits: commitList.length,
      verdicts: 0, // every commit left in the window is, by construction, ungraded
      commitList: commitList.slice(0, COMMIT_HINT_MAX_LIST),
    });
    if (!reason) return null;

    // Prefix each line with "fapony:" so it's visually distinct
    // from normal bash output in the agent's context.
    const prefixed = reason
      .split("\n")
      .map((l) => `fapony: ${l}`)
      .join("\n");
    return prefixed;
  } catch {
    return null; // any failure = no hint
  }
}

/** Claude Code PreToolUse (matcher Read): stdin JSON in, additionalContext out.
 *  No permissionDecision ever — the tool call always proceeds. */
export async function cmdHookReadHint(): Promise<void> {
  try {
    const raw = JSON.parse(await Bun.stdin.text()) as {
      cwd?: string;
      tool_input?: {
        file_path?: unknown;
        offset?: unknown;
        limit?: unknown;
      };
    };
    const cwd = raw.cwd ?? process.cwd();
    const filePath = raw.tool_input?.file_path;
    const parts: string[] = [];
    const hint = readHintFor({
      filePath,
      offset: raw.tool_input?.offset,
      limit: raw.tool_input?.limit,
      cwd,
    });
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

    // --- hint-fire log (PLAN-feedback-surface chunk 1) ---
    // After output — best-effort, never block the hint.
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

// --- Debt + mem context (PLAN-convention-debt chunk 4) ---
//
// The one moment paying down debt is worth tokens is when the file is already
// open — so hook-read-hint appends two things after the size hint: conventions
// the file still violates (debt detector, computed live) and mem rows that
// mention the file (across sessions) · **annotate only**, as before — no
// block, no dedupe, every unknown → silent · combined cap 5 lines (debt 3 · mem 2)

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
    // macOS /var → /private/var: git reports the resolved root while callers
    // pass unresolved tmp paths — normalize both sides before comparing.
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
      // A bare-basename hit is only usable when that name is unique in the
      // repo (24% of files share a basename — guessing would attach a row
      // about a DIFFERENT index.ts). The walk is paid only when a hit exists.
      let usableBase = baseOnly;
      if (baseOnly.length > 0) {
        const sameName = collectSourceFiles(worktree).filter(
          (f) => basename(f) === base,
        ).length;
        if (sameName !== 1) usableBase = [];
      }
      // direct hits (files[] / full path) outrank bare-basename hits
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
