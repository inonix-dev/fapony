import assert from "node:assert";
import {
  cursorTranscriptPath,
  decideStop,
  isCursorPayload,
  normalizeStopInput,
  stopOutput,
  utcStamp,
} from "../src/hook.js";

const base = {
  stopHookActive: false,
  worktree: "/repo",
  commits: 2,
  verdicts: 0,
};

const claudePayload = {
  cwd: "/repo",
  transcript_path: "/repo/.claude/t.jsonl",
  stop_hook_active: false,
};

// https://cursor.com/docs/agent/hooks — common schema + the stop event
const cursorPayload = {
  conversation_id: "conv-1",
  generation_id: "gen-1",
  model: "composer-1",
  model_id: "gpt-5",
  hook_event_name: "stop",
  cursor_version: "1.7.2",
  workspace_roots: ["/repo"],
  user_email: null,
  transcript_path: null,
  status: "completed",
  loop_count: 0,
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

export function testStopPayloadsMapToSameDecision(): void {
  assert.ok(
    !isCursorPayload(claudePayload),
    "claude payload must not look cursor",
  );
  assert.ok(isCursorPayload(cursorPayload), "cursor payload must be detected");

  const claude = normalizeStopInput(claudePayload, "/home/u");
  const cursor = normalizeStopInput(cursorPayload, "/home/u");
  assert.equal(claude.client, "claude");
  assert.equal(cursor.client, "cursor");
  assert.equal(claude.cwd, "/repo");
  assert.equal(cursor.cwd, "/repo", "cwd must come from workspace_roots[0]");
  assert.equal(claude.transcriptPath, "/repo/.claude/t.jsonl");
  assert.equal(
    cursor.transcriptPath,
    "/home/u/.cursor/projects/repo/agent-transcripts/conv-1/conv-1.jsonl",
  );
  assert.ok(!claude.stopHookActive);
  assert.ok(!cursor.stopHookActive);

  // Same facts through either wire format → the same verdict.
  const claudeReason = decideStop({
    stopHookActive: claude.stopHookActive,
    worktree: "/repo",
    commits: 2,
    verdicts: 0,
  });
  const cursorReason = decideStop({
    stopHookActive: cursor.stopHookActive,
    worktree: "/repo",
    commits: 2,
    verdicts: 0,
  });
  assert.ok(claudeReason, "ungraded commits must block via the claude payload");
  assert.ok(cursorReason, "ungraded commits must block via the cursor payload");
  assert.equal(claudeReason, cursorReason);
}

export function testCursorPayloadEdges(): void {
  // loop_count ≥ 1 = this hook already fired once → allow (stop_hook_active).
  const fired = normalizeStopInput(
    { ...cursorPayload, loop_count: 1 },
    "/home/u",
  );
  assert.ok(fired.stopHookActive);
  assert.strictEqual(
    decideStop({ ...base, stopHookActive: fired.stopHookActive }),
    null,
  );

  // A real transcript_path in the payload wins over the derivation.
  const withPath = normalizeStopInput(
    { ...cursorPayload, transcript_path: "/tmp/t.jsonl" },
    "/home/u",
  );
  assert.equal(withPath.transcriptPath, "/tmp/t.jsonl");

  // Slug strips the leading / and joins the rest with -.
  assert.equal(
    cursorTranscriptPath("/home/u", "/Users/x/Proj/y", "c9"),
    "/home/u/.cursor/projects/Users-x-Proj-y/agent-transcripts/c9/c9.jsonl",
  );
}

export function testStopOutputShapesPerClient(): void {
  const reason = "call verdict_submit";
  const claude = JSON.parse(stopOutput("claude", reason)) as Record<
    string,
    string
  >;
  const cursor = JSON.parse(stopOutput("cursor", reason)) as Record<
    string,
    string
  >;
  assert.equal(claude.decision, "block");
  assert.equal(claude.reason, reason);
  assert.equal(cursor.followup_message, reason);
  assert.equal(claude.followup_message, undefined);
  assert.equal(cursor.decision, undefined);
}
