import assert from "node:assert";
import { decideStop, utcStamp } from "../src/hook.js";

const base = {
  stopHookActive: false,
  worktree: "/repo",
  commits: 2,
  verdicts: 0,
};

export function testDecideStopBlocksUngradedCommits(): void {
  const reason = decideStop(base);
  assert(reason, "ungraded commits must block");
  assert(reason.includes("/repo"), "reason must name the absolute worktree");
  assert(
    reason.includes("verdict_submit"),
    "reason must name the call the agent has to make",
  );
}

export function testDecideStopAllowsEveryUnknown(): void {
  // Each of these must resolve to allow — a hook that guesses wrong traps
  // the agent, so anything it cannot prove is treated as "nothing to grade".
  const allowed: Array<[string, Parameters<typeof decideStop>[0]]> = [
    ["already blocked once", { ...base, stopHookActive: true }],
    ["not a git repo", { ...base, worktree: null }],
    ["no commits landed", { ...base, commits: 0 }],
    ["verdict already filed", { ...base, verdicts: 1 }],
  ];
  for (const [label, opts] of allowed) {
    assert.strictEqual(decideStop(opts), null, `should allow: ${label}`);
  }
}

export function testUtcStampMatchesSqliteFormat(): void {
  // events.ts is written by SQLite datetime('now') — UTC, no T, no ms.
  assert.strictEqual(
    utcStamp(new Date("2026-09-14T10:03:02.457Z")),
    "2026-09-14 10:03:02",
  );
}
