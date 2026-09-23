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
import { recordHintFire } from "../../core/hint-log.js";
import type { MemRow } from "../../core/mem-log.js";
import { readMemLog, whereMemDir } from "../../memory.js";
import { hasBugMarker } from "./bug-markers.js";

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
 * newer than session start exists, or when the agent announced a bug but
 * filed no kind:bug row.
 */
export function decideStop(opts: {
  stopHookActive: boolean;
  worktree: string | null;
  commits: number;
  since?: string | null;
  commitList?: string[];
  memLastTs?: string | null;
  memCandidates?: string[];
  bugSignal?: string | null;
  bugRowSinceStart?: boolean;
}): string | null {
  if (opts.stopHookActive) return null;
  if (!opts.worktree) return null;

  // --- Bug-signal block (independent of commits) ---
  if (opts.bugSignal && !opts.bugRowSinceStart) {
    return [
      `This turn reported a bug ("${opts.bugSignal}") but no mem row with kind:bug exists for this session.`,
      `A bug described in chat is lost when the room closes — a decision row does not surface it.`,
      `  fapony mem add bug "<what is broken>" --files <files>`,
      `Already filed elsewhere, or not a bug? End the turn again — this fires once per session.`,
    ].join("\n");
  }

  // --- Commit block (original) ---
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
  if (opts.bugSignal) {
    lines.push(
      `This turn announced a bug ("${opts.bugSignal}") — use kind:bug, not decision.`,
    );
  }
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
  kind?: string;
}

/** Absolute path of a session's block log — may not exist. */
export function stopBlockPath(session: string): string {
  const base =
    process.env.FAPONY_STATE_DIR || join(homedir(), ".config", "fapony");
  return join(base, STOP_BLOCK_DIR, `${sessionKey(session)}.jsonl`);
}

/**
 * True when this session already blocked for this worktree + kind — the caller
 * then lets the turn end. Records the block when it has not.
 *
 * `kind` defaults to `"commit"` for backwards compatibility. Bug blocks use
 * `"bug"` so they don't consume the commit block's quota.
 */
export function stopBlockedBefore(
  session: string | null,
  worktree: string,
  kind: string = "commit",
): boolean {
  if (!session) return false;
  const path = stopBlockPath(session);
  try {
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf-8").split("\n")) {
        if (!line) continue;
        try {
          const row = JSON.parse(line) as StopBlockRow;
          if (row.worktree === worktree && (row.kind ?? "commit") === kind) {
            return true;
          }
        } catch {
          // a torn line must not lose the rest of the log
        }
      }
    }
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const row: StopBlockRow = { ts: new Date().toISOString(), worktree, kind };
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
  } catch {
    return false;
  }
  return false;
}

// --- Bug-signal detection ---

/**
 * Scan assistant text from a Claude transcript for bug markers. Reads only
 * the tail of the file (last 200KB) to avoid parsing the full transcript.
 * Returns the first matched marker word, or null.
 */
export function bugSignalFromTranscript(
  transcriptPath: string,
  sinceMs: number,
): string | null {
  try {
    const stat = statSync(transcriptPath);
    // Cap at 10MB — hook must not stall turn-end
    if (stat.size > 10 * 1024 * 1024) return null;

    // Read tail to avoid parsing the full transcript
    const tailBytes = Math.min(stat.size, 200 * 1024);
    const fd = require("node:fs").openSync(transcriptPath, "r");
    const buf = Buffer.alloc(tailBytes);
    require("node:fs").readSync(
      fd,
      buf,
      0,
      tailBytes,
      Math.max(0, stat.size - tailBytes),
    );
    require("node:fs").closeSync(fd);

    const tail = buf.toString("utf-8");
    // When reading from the middle of a large file, the first line is partial
    const readingMidFile = tailBytes < stat.size;
    const startIdx = readingMidFile ? tail.indexOf("\n") : -1;
    const lines =
      startIdx >= 0 ? tail.slice(startIdx + 1).split("\n") : tail.split("\n");

    for (const line of lines) {
      if (!line) continue;
      // Transcript tail: untyped JSONL — the structural type below names only
      // the fields this scan reads (biome noExplicitAny: no `any` annotation).
      let o: {
        message?: {
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
          created_at?: string;
        };
      };
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const m = o.message;
      if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
      // Skip messages older than session start
      if (m.created_at) {
        const msgMs = new Date(m.created_at).getTime();
        if (!Number.isNaN(msgMs) && msgMs < sinceMs) continue;
      }
      for (const b of m.content) {
        if (b.type !== "text" || typeof b.text !== "string") continue;
        const hit = hasBugMarker(b.text);
        if (hit) return hit;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * True when the mem log has at least one kind:bug row with ts >= since.
 */
function hasBugRowSince(worktree: string, since: string): boolean {
  try {
    const { rows } = readMemLog(worktree, since);
    return rows.some((r) => r.kind === "bug");
  } catch {
    return false;
  }
}

// --- Handoff enforcement (PLAN-active-pain chunk 1) ---
//
// Rule 11 closes a chunk with a tick + commit + a mem note the next session
// opens from — but rule 9 says "the agent will remember" never holds. This
// checks the handoff row exists when a plan chunk was ticked this session.
// Ships as a log-only trial first: default mode only writes hint-log rows
// (surfaces handoff-would-block / handoff-pass); FAPONY_HANDOFF_BLOCK=1
// enforces for real. FAPONY_NO_HANDOFF_BLOCK=1 disables both entirely.

/** Repo-relative plan dir — hardcoded like planDir(), never from config. */
const HANDOFF_PLAN_PREFIX = ".fapony/plan/";

/** A repo-relative path the gate cares about: a .md file under plan/. */
export function isPlanPath(p: string): boolean {
  const norm = p.replace(/^\.\//, "").replace(/\\/g, "/");
  return (
    norm.startsWith(HANDOFF_PLAN_PREFIX) &&
    norm.endsWith(".md") &&
    norm.length > HANDOFF_PLAN_PREFIX.length + ".md".length
  );
}

/** Count ticked `- [x]` checkbox lines. */
export function countTicks(content: string): number {
  let n = 0;
  for (const line of content.split("\n")) {
    if (/^-\s\[[xX]\]/.test(line)) n++;
  }
  return n;
}

/**
 * A plan opts into the mechanism with a handoff literal — a checkbox line
 * mentioning handoff, ticked or not. Status is ignored on purpose: a ticked
 * box alone proves no note exists (review finding 1), so the literal only
 * marks participation and the mem row is the only way through. Plans without
 * one (every old plan) fail open.
 */
export function hasHandoffLiteral(content: string): boolean {
  for (const line of content.split("\n")) {
    if (/^-\s\[[ xX]\].*handoff/i.test(line)) return true;
  }
  return false;
}

function planRefMatches(value: string | undefined, rel: string): boolean {
  if (!value) return false;
  const v = value.replace(/^\.\//, "").replace(/\\/g, "/");
  const r = rel.replace(/^\.\//, "").replace(/\\/g, "/");
  if (v === r) return true;
  if (v.endsWith(`/${r}`) || r.endsWith(`/${v}`)) return true;
  // Plan filenames are unique per repo (PLAN-<name>.md) — a bare basename
  // still names the file when one side stored only it.
  const vb = v.split("/").pop() ?? v;
  const rb = r.split("/").pop() ?? r;
  return vb.length > 0 && vb === rb;
}

/**
 * True when a note/next row filed at or after session start points at the
 * plan — via spec (the positional plan path of `mem add`) or files[].
 * Timestamps compare numerically: mem rows are ISO, session start is
 * utcStamp, and string-compare reads every same-day row as newer ('T' > ' ').
 */
export function memHasHandoffForPlan(
  rows: MemRow[],
  planRel: string,
  sinceMs: number,
): boolean {
  for (const r of rows) {
    if (r.kind !== "note" && r.kind !== "next") continue;
    const ms = hookTsMs(r.ts);
    if (Number.isNaN(ms) || ms < sinceMs) continue;
    if (planRefMatches(r.spec, planRel)) return true;
    for (const f of r.files ?? []) {
      if (planRefMatches(f, planRel)) return true;
    }
  }
  return false;
}

export interface HandoffPlanFile {
  /** Repo-relative plan path, e.g. .fapony/plan/PLAN-x.md. */
  rel: string;
  /** Content at the pre-session base commit ("" when untracked there). */
  before: string;
  /** Content on disk now. */
  after: string;
}

export interface HandoffDecision {
  /** First plan with literal + new tick + no handoff row, or null. */
  blockedPlan: string | null;
  /** Plans the gate actually evaluated (literal present). */
  evaluated: string[];
}

/**
 * Pure decision over pre-loaded file states. Every condition must hold to
 * block: literal present, more ticks than at base, no handoff row since
 * session start. Anything else passes — including plans that never opted in.
 */
export function decideHandoff(opts: {
  files: HandoffPlanFile[];
  memRows: MemRow[];
  sinceMs: number;
}): HandoffDecision {
  const evaluated: string[] = [];
  let blockedPlan: string | null = null;
  for (const f of opts.files) {
    if (!hasHandoffLiteral(f.after)) continue;
    evaluated.push(f.rel);
    if (blockedPlan) continue;
    if (countTicks(f.after) <= countTicks(f.before)) continue;
    if (memHasHandoffForPlan(opts.memRows, f.rel, opts.sinceMs)) continue;
    blockedPlan = f.rel;
  }
  return { blockedPlan, evaluated };
}

export function handoffBlockMessage(planRel: string): string {
  return [
    `Chunk ticked in ${planRel} but no handoff mem row exists for this session.`,
    `The next session opens from that note — without it, chunk N+1 re-derives everything from zero.`,
    `  fapony mem add note "<what chunk N+1 must know>" --files <files> ${planRel}`,
    `Then end the turn again — the row is the handoff; ticking the literal is cosmetic.`,
    `Fires once per session.`,
  ].join("\n");
}

/** Plan files this session wrote: committed since birthtime, unstaged, or brand-new. */
export function sessionPlanFiles(
  cwd: string,
  since: string,
): string[] | null {
  const names = (args: string[]): string[] | null => {
    const out = git(args, cwd);
    if (out === null) return null;
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  };
  const a = names(["log", "--name-only", "--since", `${since} +0000`, "--format="]);
  const b = names(["diff", "--name-only", "HEAD"]);
  const c = names(["ls-files", "--others", "--exclude-standard"]);
  if (!a && !b && !c) return null;
  const seen = new Set<string>();
  for (const list of [a, b, c]) {
    for (const p of list ?? []) {
      const norm = p.replace(/^\.\//, "");
      if (isPlanPath(norm)) seen.add(norm);
    }
  }
  return [...seen].sort();
}

/**
 * Last commit that existed before the session started — the baseline a
 * "new tick" compares against. `git diff HEAD` alone misses the common case:
 * the chunk workflow commits the tick before the hook fires.
 */
export function handoffBaseSha(cwd: string, since: string): string | null {
  const sha = git(["rev-list", "-1", `--before=${since} +0000`, "HEAD"], cwd);
  return sha || null;
}

/** File content at a revision, or null when untracked there / on git error. */
export function fileAtRevision(
  cwd: string,
  base: string,
  rel: string,
): string | null {
  return git(["show", `${base}:${rel}`], cwd);
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
    let bugSignal: string | null = null;
    let bugRowSinceStart = false;
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
      // Bug-signal detection (independent of commits)
      if (norm.transcriptPath && process.env.FAPONY_NO_BUG_BLOCK !== "1") {
        const sinceMs = hookTsMs(since);
        if (!Number.isNaN(sinceMs)) {
          bugSignal = bugSignalFromTranscript(norm.transcriptPath, sinceMs);
          if (bugSignal) bugRowSinceStart = hasBugRowSince(worktree, since);
        }
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
      bugSignal,
      bugRowSinceStart,
    });

    // Handoff trial (PLAN-active-pain chunk 1): independent of commits.
    // Default ships log-only — a would-block/pass row in hint-log answers
    // the trial questions (gate precision, read-only silence, old-plan
    // silence, committed-tick detection) without blocking anyone.
    // FAPONY_HANDOFF_BLOCK=1 enforces; FAPONY_NO_HANDOFF_BLOCK=1 skips all.
    // Kept in its own variable so the commit/bug dedupe below never consumes
    // a handoff block's quota (or vice versa) — each kind fires once.
    let handoffReason: string | null = null;
    if (
      worktree &&
      since &&
      process.env.FAPONY_NO_HANDOFF_BLOCK !== "1" &&
      !norm.stopHookActive
    ) {
      try {
        const sinceMs = hookTsMs(since);
        if (!Number.isNaN(sinceMs)) {
          const plans = sessionPlanFiles(norm.cwd, since);
          if (plans && plans.length > 0) {
            const baseSha = handoffBaseSha(norm.cwd, since);
            if (baseSha) {
              const handoffMem = readMemLog(worktree);
              // No log at all = fail-open, silently: without mem data the
              // evaluation never ran, so a pass row would pollute the trial.
              if (handoffMem.filesFound > 0) {
                const files: HandoffPlanFile[] = [];
                for (const rel of plans) {
                  let after: string | null = null;
                  try {
                    after = await Bun.file(join(worktree, rel)).text();
                  } catch {
                    after = null;
                  }
                  if (after === null) continue;
                  files.push({
                    rel,
                    before: fileAtRevision(norm.cwd, baseSha, rel) ?? "",
                    after,
                  });
                }
                if (files.length > 0) {
                  const h = decideHandoff({
                    files,
                    memRows: handoffMem.rows,
                    sinceMs,
                  });
                  const now = new Date().toISOString();
                  if (h.blockedPlan) {
                    recordHintFire({
                      ts: now,
                      worktree,
                      surface: "handoff-would-block",
                      file: h.blockedPlan,
                      count: 1,
                    });
                    if (
                      process.env.FAPONY_HANDOFF_BLOCK === "1" &&
                      !reason &&
                      !stopBlockedBefore(
                        norm.transcriptPath,
                        worktree,
                        "handoff",
                      )
                    ) {
                      handoffReason = handoffBlockMessage(h.blockedPlan);
                    }
                  } else if (h.evaluated.length > 0) {
                    recordHintFire({
                      ts: now,
                      worktree,
                      surface: "handoff-pass",
                      file: h.evaluated[0],
                      count: 1,
                    });
                  }
                }
              }
            }
          }
        }
      } catch {
        // fail-open — never block on handoff machinery failing
      }
    }

    if (
      reason &&
      worktree &&
      stopBlockedBefore(
        norm.transcriptPath,
        worktree,
        bugSignal ? "bug" : "commit",
      )
    ) {
      reason = null;
    }
    // Handoff merges last and only fills an otherwise-allowed turn — the
    // commit/bug dedupe above never sees (or consumes) its quota.
    if (!reason) reason = handoffReason;
  } catch {
    reason = null;
  }

  if (reason) console.log(stopOutput(client, reason));
}
