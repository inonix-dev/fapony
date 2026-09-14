// src/hook.ts — Claude Code Stop hook: refuse to end a turn that produced
// commits but no verdict.
//
// ทำไมต้องเป็น hook ไม่ใช่ข้อความ: SERVER_INSTRUCTIONS เป็นการ *ขอ* ให้ agent จำ
// วัดแล้วว่าไม่พอ · hook ไม่ได้ตัดสินเกรดแทน (ตัดสินไม่ได้ — มันไม่เห็นว่างานผ่านหรือพัง)
// มันแค่ไม่ให้จบเทิร์นจนกว่า agent จะตัดสินเอง แยก "ใครตัดสิน" ออกจาก "ใครบังคับให้ตัดสิน"
//
// สัญญาณคือ commit ไม่ใช่ dirty tree — dirty = กำลังทำอยู่, commit = หน่วยงานจบแล้ว
// ตรงกับนิยาม "1 run = 1 หน่วยงานที่วัดได้" (กฎ 7)

import { statSync } from "node:fs";
import { openDb } from "./db/index.js";

export interface StopHookInput {
  cwd?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
}

/** UTC 'YYYY-MM-DD HH:MM:SS' — the format events.ts is written in. */
export function utcStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Pure decision: block only when this session produced commits and none of
 * them got graded. Every unknown (no git, no transcript, hook already fired)
 * resolves to "allow" — a hook that guesses wrong must never trap the agent.
 */
export function decideStop(opts: {
  stopHookActive: boolean;
  worktree: string | null;
  commits: number;
  verdicts: number;
}): string | null {
  if (opts.stopHookActive) return null; // already blocked once — let it end
  if (!opts.worktree) return null;
  if (opts.commits < 1) return null;
  if (opts.verdicts > 0) return null;
  return (
    `${opts.commits} commit(s) landed in ${opts.worktree} this session with no verdict filed.\n` +
    `Call verdict_submit before ending: worktree must be the absolute path above, ` +
    `regime is one of code|fix|review|plan|inquiry|test, and the note must stand alone ` +
    `(it is read months from now with no access to this conversation). ` +
    `Grade what actually happened — pass-family when it held up, fail if the first ` +
    `attempt was wrong, uncertain when you could not verify it.`
  );
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
  try {
    const input = JSON.parse(await Bun.stdin.text()) as StopHookInput;
    const cwd = input.cwd ?? process.cwd();
    const worktree = git(["rev-parse", "--show-toplevel"], cwd);

    // Session start = when the transcript file was created. No transcript,
    // no window to measure — allow.
    let since: string | null = null;
    if (input.transcript_path) {
      try {
        since = utcStamp(statSync(input.transcript_path).birthtime);
      } catch {
        since = null;
      }
    }

    let commits = 0;
    let verdicts = 0;
    if (worktree && since) {
      const log = git(["log", "--since", `${since} +0000`, "--oneline"], cwd);
      commits = log ? log.split("\n").filter(Boolean).length : 0;
      if (commits > 0) {
        const db = openDb();
        const row = db
          .query(
            `SELECT COUNT(*) AS n FROM events e JOIN runs r ON r.id = e.run_id
             WHERE e.kind = 'gate' AND r.worktree = ? AND e.ts >= ?`,
          )
          .get(worktree, since) as { n: number } | null;
        verdicts = row?.n ?? 0;
      }
    }

    reason = decideStop({
      stopHookActive: input.stop_hook_active === true,
      worktree: since ? worktree : null,
      commits,
      verdicts,
    });
  } catch {
    reason = null; // any failure = allow the turn to end
  }

  if (reason) console.log(JSON.stringify({ decision: "block", reason }));
}
