import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cursorTranscriptPath,
  decideStop,
  isCursorPayload,
  normalizeStopInput,
  READ_HINT_MIN_BYTES,
  readHintFor,
  stopOutput,
  utcStamp,
} from "../src/hook.js";
import { readHintPluginSource } from "../src/install/opencode.js";

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

export function testDecideStopReportsCommitsAndMem(): void {
  // PLAN-mem-mcp chunk 3 (Done criteria 4): the block message carries the
  // commit list and the mem status — information, never a block condition.
  const reason = decideStop({
    ...base,
    commits: 7,
    commitList: [
      "edcb02e fix(analyze): skip nested checkouts by .git",
      "f90784b fix(mcp): fapony_usage reads four clients",
      "75d0b04 refactor(mcp): drop the handoff trio",
      "aaaaaaa c4",
      "bbbbbbb c5",
      "ccccccc c6",
      "ddddddd c7",
    ],
    memLastTs: "2026-09-16T08:00:00.000Z",
  });
  assert(reason);
  for (const sha of ["edcb02e", "f90784b", "75d0b04", "aaaaaaa", "bbbbbbb"]) {
    assert.ok(reason.includes(sha), `lists ${sha}`);
  }
  assert.ok(reason.includes("… +2 more"), "folds commits past 5");
  assert.ok(!reason.includes("ccccccc"), "does not list past the cap");
  assert.ok(
    reason.includes("mem: last row 2026-09-16"),
    "mem status is information",
  );
  assert.ok(
    reason.includes("your call"),
    "mem is never presented as required — the agent decides",
  );
  // ≤ 12 lines (spec §6)
  assert.ok(reason.split("\n").length <= 12, "message stays short");

  // No mem at all must read differently from "nothing newer"
  const noMem = decideStop({ ...base, memLastTs: null });
  assert.ok(noMem?.includes("no rows at all"));
}

export function testDecideStopMemNeverBlocks(): void {
  // กฎ 7 — mem status is data: the block condition stays verdict-only,
  // so a fresh mem row changes the message, not the decision.
  const without = decideStop(base);
  const withFreshMem = decideStop({
    ...base,
    memLastTs: "2026-09-17T00:00:00Z",
  });
  assert.ok(without, "blocks without mem");
  assert.ok(withFreshMem, "blocks identically with mem present");
  assert.notEqual(without, withFreshMem);
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

// --- Read hint (PreToolUse annotate) ---

import { withTempRepo } from "./helpers.js";

/** > 2× threshold, so the fixture stays valid if the constant moves. */
const PAD = Math.ceil(READ_HINT_MIN_BYTES / 20) * 20 + 40;

function padFile(dir: string, name: string): string {
  const p = join(dir, name);
  const body = Array.from(
    { length: PAD },
    (_, i) => `const pad${i} = ${i}; // padding`,
  ).join("\n");
  writeFileSync(p, `export const entry = () => {\n${body}\n};\n`);
  return p;
}

export function testReadHintAnnotatesLargeFullRead(): void {
  withTempRepo((dir) => {
    const p = padFile(dir, "big.ts");
    const hint = readHintFor({ filePath: p, cwd: dir });
    assert.ok(hint, "large full read must get a hint");
    assert.match(hint ?? "", /big\.ts is \d+ lines/);
    assert.match(hint ?? "", /review-seed --files big\.ts/);
    assert.match(hint ?? "", /measured /);
  });
  console.log("  ✓ read hint annotates large full-file read");
}

export function testReadHintSkipsCheapReads(): void {
  withTempRepo((dir) => {
    const big = padFile(dir, "big.ts");
    // bounded read — the caller already kept it cheap
    assert.equal(
      readHintFor({ filePath: big, limit: 50, cwd: dir }),
      null,
      "bounded read must stay silent",
    );
    // a large limit is still a full read in spirit
    assert.ok(
      readHintFor({ filePath: big, limit: 5000, cwd: dir }),
      "large limit must still hint",
    );
    // small file
    const small = join(dir, "small.ts");
    writeFileSync(small, "export const tiny = 1;\n");
    assert.equal(readHintFor({ filePath: small, cwd: dir }), null);
    // non-source extension
    const md = join(dir, "README.md");
    writeFileSync(md, "x".repeat(READ_HINT_MIN_BYTES * 2));
    assert.equal(readHintFor({ filePath: md, cwd: dir }), null);
    // nonexistent path
    assert.equal(
      readHintFor({ filePath: join(dir, "nope.ts"), cwd: dir }),
      null,
    );
    assert.equal(readHintFor({ filePath: null, cwd: dir }), null);
  });
  console.log(
    "  ✓ read hint skips bounded reads, small files, non-source, missing",
  );
}

export function testReadHintNeedsGitRepo(): void {
  // Outside a repo the hint would point at a command that cannot run.
  const dir = mkdtempSync(join(tmpdir(), "fapony-rh-norepo-"));
  try {
    const p = padFile(dir, "big.ts");
    assert.equal(readHintFor({ filePath: p, cwd: dir }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ read hint stays silent outside a git repo");
}

export function testReadHintClaudeOutputShape(): void {
  // cmdHookReadHint is a thin wrapper; assert the pure core feeds the
  // documented additionalContext shape via the real stdin/stdout path.
  withTempRepo((dir) => {
    const p = padFile(dir, "big.ts");
    const proc = Bun.spawnSync(
      ["bun", join(import.meta.dir, "..", "fapony.ts"), "hook-read-hint"],
      {
        cwd: dir,
        stdin: Buffer.from(
          JSON.stringify({ cwd: dir, tool_input: { file_path: p } }),
        ),
        stdout: "pipe",
      },
    );
    const out = JSON.parse(proc.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.ok(typeof out.hookSpecificOutput.additionalContext === "string");
    assert.ok(
      !JSON.stringify(out).includes("permissionDecision"),
      "annotate-only: no permissionDecision may ever appear",
    );
  });
  console.log("  ✓ read hint claude output = additionalContext, no decision");
}

export function testReadHintPluginSource(): void {
  // The generated OpenCode plugin must import the shared logic (no second
  // implementation), target the read tool, and mutate output only.
  const src = readHintPluginSource("/install/root");
  assert.ok(
    src.includes("/install/root/src/hook.ts"),
    "bakes the install root",
  );
  assert.ok(src.includes('input.tool !== "read"'), "guards the tool name");
  assert.ok(src.includes("output.output"), "mutates the tool output");
  assert.ok(!src.includes("throw"), "must never throw into the tool call");
  console.log(
    "  ✓ read hint opencode plugin imports shared logic, annotate-only",
  );
}
