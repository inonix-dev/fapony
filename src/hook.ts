// src/hook.ts — Claude Code / Cursor Stop hook: refuse to end a turn that produced
// commits but no verdict.
//
// ทำไมต้องเป็น hook ไม่ใช่ข้อความ: SERVER_INSTRUCTIONS เป็นการ *ขอ* ให้ agent จำ
// วัดแล้วว่าไม่พอ · hook ไม่ได้ตัดสินเกรดแทน (ตัดสินไม่ได้ — มันไม่เห็นว่างานผ่านหรือพัง)
// มันแค่ไม่ให้จบเทิร์นจนกว่า agent จะตัดสินเอง แยก "ใครตัดสิน" ออกจาก "ใครบังคับให้ตัดสิน"
//
// สัญญาณคือ commit ไม่ใช่ dirty tree — dirty = กำลังทำอยู่, commit = หน่วยงานจบแล้ว
// ตรงกับนิยาม "1 run = 1 หน่วยงานที่วัดได้" (กฎ 7)
//
// สอง payload หนึ่งการตัดสิน — field-mapping เท่านั้น:
//   claude  {cwd, transcript_path, stop_hook_active} → {"decision":"block"}
//   cursor  {workspace_roots, conversation_id, loop_count, status} → {"followup_message"}
//   (cursor: loop_count ≥ 1 = hook เคยยิงแล้ว, status ≠ completed = ปล่อยผ่าน)

import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { collectSourceFiles, SCAN_EXTS } from "./analyze.js";
import { openDb } from "./db/index.js";
import { debtForFile, loadConventions } from "./debt.js";
import { readMemLog } from "./memory.js";

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
 * the block condition stays verdict-only (กฎ 7: the hook does not judge, it
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
        // becomes a block condition, กฎ 7).
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
// การอ่านไฟล์ใหญ่ทั้งไฟล์เป็นจุดที่ agent จ่าย token โดยไม่รู้ตัว — เสียงเตือน
// ใน skill ไม่เคยพอ (หลักเดียวกับ Stop hook: พูดตอนมันกำลังจ่าย) แต่ hook นี้
// **annotate เท่านั้น**: ไม่มี permissionDecision, ไม่มี "อ่านไปแล้ว" dedupe —
// context compaction ทำให้ "อ่านไปแล้ว" กลายเป็นเท็จ และ hook ที่เดาผิดแล้วขัง
// agent แย่กว่าไม่มี hook (กฎของ hook.ts เดิม) — annotate ขังไม่ได้ด้วย
// construction, ต้นทุนพลาดสูงสุดคือบรรทัดเดียวที่ไม่จำเป็น
//
// ข้อความเป็น fact ล้วน (จำนวนบรรทัด + คำสั่ง + ค่าที่วัดครั้งเดียว) ไม่ใช่
// estimate ต่อไฟล์ — เดา token เป็นการแต่งตัวเป็นข้อมูล ขัด "facts only"

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
    const parts: string[] = [];
    const hint = readHintFor({
      filePath: raw.tool_input?.file_path,
      offset: raw.tool_input?.offset,
      limit: raw.tool_input?.limit,
      cwd,
    });
    if (hint) parts.push(hint);
    for (const line of readContextLines(raw.tool_input?.file_path, cwd)) {
      parts.push(line);
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
  } catch {
    // any failure = no hint; a hook must never block a read over a hint
  }
}

// --- Debt + mem context (PLAN-convention-debt chunk 4) ---
//
// จังหวะเดียวที่การแก้หนี้คุ้ม token คือตอนที่เปิดไฟล์นั้นอยู่แล้ว — hook-read-hint
// จึงแนบสองอย่างต่อท้าย size hint: convention ที่ไฟล์ยังค้าง (debt detector, คำนวณสด)
// และแถว mem ที่เอ่ยถึงไฟล์นั้น (ข้าม session) · **annotate เท่านั้น** เหมือนเดิม —
// ไม่ block, ไม่ dedupe, ทุก unknown → เงียบ · cap รวม 5 บรรทัด (หนี้ 3 · mem 2)

const DEBT_HINT_MAX = 3;
const MEM_HINT_MAX = 2;
const MEM_TEXT_MAX = 120;

export function readContextLines(filePath: unknown, cwd: string): string[] {
  try {
    if (typeof filePath !== "string" || filePath === "") return [];
    const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (git.exitCode !== 0) return [];
    // macOS /var → /private/var: git reports the resolved root while callers
    // pass unresolved tmp paths — normalize both sides before comparing.
    const worktree = realpathSync(git.stdout.toString().trim());
    const abs = realpathSync(
      filePath.startsWith("/") ? filePath : join(worktree, filePath),
    );
    const rel = relative(worktree, abs).split("\\").join("/");
    if (rel.startsWith("..") || rel === "") return [];

    const lines: string[] = [];

    // convention debt — source files only, fresh from the repo
    const dot = rel.lastIndexOf(".");
    if (dot >= 0 && SCAN_EXTS.has(rel.slice(dot))) {
      for (const c of debtForFile(
        worktree,
        abs,
        loadConventions(worktree),
      ).slice(0, DEBT_HINT_MAX)) {
        lines.push(`fapony debt: [${c.id}] ${c.rule}`);
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
      const memLines = [...direct, ...usableBase].slice(0, MEM_HINT_MAX);
      for (const r of memLines) {
        lines.push(
          `fapony mem: ${r.ts.slice(0, 10)} ${r.kind} — ${r.text.slice(0, MEM_TEXT_MAX)}`,
        );
      }
    }
    return lines.slice(0, DEBT_HINT_MAX + MEM_HINT_MAX);
  } catch {
    return [];
  }
}
