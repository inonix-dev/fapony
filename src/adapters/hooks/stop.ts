// src/adapters/hooks/stop.ts — Stop hook: refuse to end a turn that produced
// commits but no mem row.
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). Pure helpers (utcStamp,
// hookTsMs, sessionKey) live in core/hook-helpers.ts.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hookTsMs, sessionKey, utcStamp } from "../../core/hook-helpers.js";
import { readMemLog, whereMemDir } from "../../memory.js";

// --- Types ---

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
  // Codex — hooks contract (https://learn.chatgpt.com/docs/hooks)
  session_id?: string;
  model?: string;
  permission_mode?: string;
}

export type StopClient = "claude" | "cursor" | "codex";

export interface NormalizedStopInput {
  client: StopClient;
  cwd: string;
  transcriptPath: string | null;
  stopHookActive: boolean;
}

// --- Pure helpers ---

/** Cursor transcript location derived from the conversation id. */
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

/** Codex sends permission_mode and/or model — fields neither Claude nor Cursor include in Stop. */
export function isCodexPayload(raw: RawStopPayload): boolean {
  return (
    typeof raw.permission_mode === "string" ||
    (typeof raw.model === "string" && !isCursorPayload(raw))
  );
}

/** Field-mapping only — all three clients feed the same decideStop below. */
export function normalizeStopInput(
  raw: RawStopPayload,
  home: string,
): NormalizedStopInput {
  if (isCodexPayload(raw)) {
    return {
      client: "codex",
      cwd: raw.cwd ?? process.cwd(),
      transcriptPath:
        typeof raw.transcript_path === "string" && raw.transcript_path
          ? raw.transcript_path
          : null,
      stopHookActive: raw.stop_hook_active === true,
    };
  }
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

/**
 * Pure decision: block when this session produced commits but no mem row
 * newer than session start exists.
 */
export function decideStop(opts: {
  stopHookActive: boolean;
  worktree: string | null;
  commits: number;
  since?: string | null;
  commitList?: string[];
  memLastTs?: string | null;
  memCandidates?: string[];
}): string | null {
  if (opts.stopHookActive) return null;
  if (!opts.worktree) return null;
  if (opts.commits < 1) return null;
  if (!opts.memLastTs && !opts.memCandidates?.length) return null;
  if (opts.since && opts.memLastTs) {
    const sinceMs = hookTsMs(opts.since);
    const memMs = hookTsMs(opts.memLastTs);
    if (Number.isNaN(sinceMs) || Number.isNaN(memMs)) return null;
    if (memMs >= sinceMs) return null;
  }

  const lines: string[] = [
    `${opts.commits} commit(s) landed in ${opts.worktree} this session — no mem row recorded for this work.`,
  ];
  const list = opts.commitList ?? [];
  for (const c of list.slice(0, 5)) lines.push(`  ${c}`);
  if (list.length > 5) lines.push(`  … +${list.length - 5} more`);
  if (opts.memLastTs) {
    lines.push(
      `mem: last row ${opts.memLastTs.slice(0, 10)} — nothing newer this session`,
    );
  } else if (opts.memCandidates?.length) {
    lines.push(
      `mem: no log in scope from ${opts.worktree} — found ` +
        `${opts.memCandidates.join(", ")} (run mem commands from there, or --mem-dir)`,
    );
  }

  lines.push(
    `Record a mem row before ending: fapony mem add <decision|bug|note> "what happened" --files <files> ` +
      `${opts.worktree}/.fapony/plan/PLAN.md (or the relevant plan). ` +
      `files[] is required — a row without it is unfindable when you touch that file next session.`,
  );
  return lines.join("\n");
}

/** Claude blocks with decision:block; Cursor auto-submits as followup_message;
 *  Codex continues with decision:block + reason. */
export function stopOutput(client: StopClient, reason: string): string {
  if (client === "cursor") return JSON.stringify({ followup_message: reason });
  if (client === "codex") return JSON.stringify({ decision: "block", reason });
  return JSON.stringify({ decision: "block", reason });
}

// --- Block dedupe ---

const STOP_BLOCK_DIR = "stop-block";

interface StopBlockRow {
  ts: string;
  worktree: string;
}

/** Absolute path of a session's block log — may not exist. */
export function stopBlockPath(session: string): string {
  const base =
    process.env.FAPONY_STATE_DIR || join(homedir(), ".config", "fapony");
  return join(base, STOP_BLOCK_DIR, `${sessionKey(session)}.jsonl`);
}

/**
 * True when this session already blocked for this worktree — the caller then
 * lets the turn end. Records the block when it has not.
 */
export function stopBlockedBefore(
  session: string | null,
  worktree: string,
): boolean {
  if (!session) return false;
  const path = stopBlockPath(session);
  try {
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf-8").split("\n")) {
        if (!line) continue;
        try {
          if ((JSON.parse(line) as StopBlockRow).worktree === worktree) {
            return true;
          }
        } catch {
          // a torn line must not lose the rest of the log
        }
      }
    }
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const row: StopBlockRow = { ts: new Date().toISOString(), worktree };
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
  } catch {
    return false;
  }
  return false;
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

/** Reads the Stop-hook JSON on stdin, prints a block decision or nothing. */
export async function cmdHookStop(): Promise<void> {
  let reason: string | null = null;
  let client: StopClient = "claude";
  try {
    const raw = JSON.parse(await Bun.stdin.text()) as RawStopPayload;
    const norm = normalizeStopInput(raw, homedir());
    client = norm.client;
    if (client === "cursor" && raw.status !== "completed") return;

    const worktree = git(["rev-parse", "--show-toplevel"], norm.cwd);

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
    let memLastTs: string | null = null;
    let memCandidates: string[] = [];
    if (worktree && since) {
      const log = git(
        ["log", "--since", `${since} +0000`, "--format=%h %s"],
        norm.cwd,
      );
      commitList = log ? log.split("\n").filter(Boolean) : [];
      commits = commitList.length;
      try {
        const mem = readMemLog(worktree);
        memLastTs = mem.rows[0]?.ts ?? null;
        if (!memLastTs) memCandidates = whereMemDir(worktree).candidates ?? [];
      } catch {
        memLastTs = null;
      }
    }

    reason = decideStop({
      stopHookActive: norm.stopHookActive,
      worktree: since ? worktree : null,
      commits,
      since,
      commitList,
      memLastTs,
      memCandidates,
    });
    if (
      reason &&
      worktree &&
      stopBlockedBefore(norm.transcriptPath, worktree)
    ) {
      reason = null;
    }
  } catch {
    reason = null;
  }

  if (reason) console.log(stopOutput(client, reason));
}
