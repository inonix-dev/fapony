import { test } from "bun:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cursorTranscriptPath,
  decideStop,
  isCodexPayload,
  isCursorPayload,
  normalizeStopInput,
  stopBlockedBefore,
  stopOutput,
  utcStamp,
} from "../../src/hook.js";
import {
  base,
  claudePayload,
  codexPayload,
  cursorPayload,
} from "./fixtures.js";
import { withStateDir } from "./helpers.js";

test("testDecideStopBlocksUngradedCommits", () => {
  const reason = decideStop(base);
  assert(reason, "commits with no new mem row must block");
  assert(reason.includes("/repo"), "reason must name the absolute worktree");
  assert(
    reason.includes("mem add"),
    "reason must name the mem command the agent has to make",
  );
});

test("testDecideStopReportsCommitsAndMem", () => {
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
  // ≤ 12 lines (spec §6)
  assert.ok(reason.split("\n").length <= 12, "message stays short");

  // No mem at all must NOT block (allow = null)
  const noMem = decideStop({ ...base, memLastTs: null });
  assert.strictEqual(noMem, null, "no mem log at all = allow");
});

// Regression 2026-09-21: a monorepo whose only log lives in apps/<x> got
// "no rows at all — nothing recorded in this project yet" on every block,
// which is false. Out of scope and absent must read differently.
test("testDecideStopNamesOutOfScopeMemLog", () => {
  const reason = decideStop({
    ...base,
    memLastTs: null,
    memCandidates: ["/repo/apps/vela/.fapony/.memory"],
  });
  assert.ok(reason);
  assert.ok(
    !reason.includes("no rows at all"),
    "must not claim nothing was recorded when a log exists",
  );
  assert.ok(
    reason.includes("/repo/apps/vela/.fapony/.memory"),
    "names where the log actually is",
  );
  console.log("  ✓ block message names an out-of-scope mem log");
});

// The first block delivers the message; blocks 2-5 in the same session deliver
// noise. stop_hook_active only covers the turn immediately after a block.
test("testStopBlocksOncePerSessionPerWorktree", () => {
  withStateDir((_dir) => {
    const session = "/tmp/transcripts/sess-b.jsonl";
    assert.equal(
      stopBlockedBefore(session, "/repo/a"),
      false,
      "first block goes through",
    );
    assert.equal(
      stopBlockedBefore(session, "/repo/a"),
      true,
      "second block in the same session is suppressed",
    );
    assert.equal(
      stopBlockedBefore(session, "/repo/b"),
      false,
      "a different worktree still blocks once",
    );
    assert.equal(
      stopBlockedBefore("/tmp/transcripts/sess-c.jsonl", "/repo/a"),
      false,
      "a new session starts over",
    );
    assert.equal(
      stopBlockedBefore(null, "/repo/a"),
      false,
      "no session identity = no dedupe, block as before",
    );
  });
  console.log("  ✓ Stop blocks once per session + worktree");
});

test("testDecideStopMessageIsRepoNeutral", () => {
  const reason = decideStop(base);
  assert(reason);
  assert.doesNotMatch(
    reason,
    /bun fapony\.ts|fapony lint-baseline|npm (run|test|exec)|pnpm |npx |yarn /,
    "block message must not name repo-specific commands",
  );
});

test("testDecideStopDerivesCommandFromWorktree", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-stop-derive-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ packageManager: "bun@1.2.0" }),
    );
    const reason = decideStop({
      stopHookActive: false,
      worktree: dir,
      commits: 1,
      memLastTs: "2026-09-15T00:00:00Z",
      since: "2026-09-20T00:00:00Z",
    });
    assert(reason, "blocks");
    assert.doesNotMatch(
      reason,
      /bun fapony\.ts|fapony lint-baseline/,
      "never names fapony commands",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // A foreign worktree (no packageManager, no lockfile) falls back to the
  // generic phrase — detectTestRunner returns null, no guessing.
  const foreign = mkdtempSync(join(tmpdir(), "fapony-stop-foreign-"));
  try {
    writeFileSync(join(foreign, "package.json"), JSON.stringify({ name: "x" }));
    const reason = decideStop({
      stopHookActive: false,
      worktree: foreign,
      commits: 1,
      memLastTs: "2026-09-15T00:00:00Z",
      since: "2026-09-20T00:00:00Z",
    });
    assert(reason);
    assert.match(reason, /mem add/, "foreign worktree → mem add command");
  } finally {
    rmSync(foreign, { recursive: true, force: true });
  }
  console.log(
    "  ✓ decideStop derives test command from worktree, falls back for foreign",
  );
});

test("testStopHookSourceHasNoRepoSpecificCommands", () => {
  for (const file of ["hook.ts", "setup.ts"]) {
    const src = readFileSync(join(__dirname, "..", "..", "src", file), "utf-8");
    const bad = src.match(
      /bun fapony\.ts|npm (run test|test|exec)|pnpm test|yarn test/,
    );
    assert.ok(
      !bad,
      `${file} hardcodes repo-specific verify command: "${bad?.[0]}" — derive via detectTestRunner`,
    );
  }
  console.log(
    "  ✓ hook.ts / setup.ts source sweeps clean (no hardcoded repo verify commands)",
  );
});

test("testDecideStopMemBlocksWhenStale", () => {
  const without = decideStop(base);
  const withStaleMem = decideStop({
    ...base,
    memLastTs: "2026-09-10T00:00:00Z",
  });
  assert.ok(without, "blocks without mem");
  assert.ok(withStaleMem, "blocks with stale mem (older than session start)");
  // But a fresh mem row (newer than session start) allows.
  const withFreshMem = decideStop({
    ...base,
    memLastTs: "2026-09-21T00:00:00Z",
  });
  assert.strictEqual(
    withFreshMem,
    null,
    "allows when mem row is newer than session",
  );
});

test("testDecideStopComparesProductionTimestampShapes", () => {
  const prod = {
    stopHookActive: false,
    worktree: "/repo",
    commits: 1,
    commitList: ["abc work"],
    since: "2026-09-21 08:00:00",
  };
  assert.ok(
    decideStop({ ...prod, memLastTs: "2026-09-21T07:59:59.000Z" }),
    "same-day row older than session start must block",
  );
  assert.strictEqual(
    decideStop({ ...prod, memLastTs: "2026-09-21T08:00:01.000Z" }),
    null,
    "same-day row newer than session start must allow",
  );
  assert.ok(
    decideStop({ ...prod, memLastTs: "2026-09-20T23:00:00.000Z" }),
    "previous-day row must block",
  );
});

test("testDecideStopAllowsEveryUnknown", () => {
  const allowed: Array<[string, Parameters<typeof decideStop>[0]]> = [
    ["already blocked once", { ...base, stopHookActive: true }],
    ["not a git repo", { ...base, worktree: null }],
    ["no commits landed", { ...base, commits: 0 }],
    ["no mem log at all", { ...base, memLastTs: null, memCandidates: [] }],
    ["fresh mem row exists", { ...base, memLastTs: "2026-09-21T00:00:00Z" }],
  ];
  for (const [label, opts] of allowed) {
    assert.strictEqual(decideStop(opts), null, `should allow: ${label}`);
  }
});

test("testStopBlockedBeforeBugSeparateFromCommit", () => {
  withStateDir(() => {
    const session = "/tmp/transcripts/sess-bug.jsonl";
    // First commit block goes through
    assert.equal(
      stopBlockedBefore(session, "/repo"),
      false,
      "first commit block",
    );
    // Second commit block is suppressed
    assert.equal(
      stopBlockedBefore(session, "/repo"),
      true,
      "second commit block suppressed",
    );
    // But bug block still fires (separate kind)
    assert.equal(
      stopBlockedBefore(session, "/repo", "bug"),
      false,
      "bug block not consumed by commit",
    );
    // Bug block dedupes on its own
    assert.equal(
      stopBlockedBefore(session, "/repo", "bug"),
      true,
      "second bug block suppressed",
    );
    // A different worktree still blocks for both kinds
    assert.equal(
      stopBlockedBefore(session, "/repo/b"),
      false,
      "different worktree commit block",
    );
    assert.equal(
      stopBlockedBefore(session, "/repo/b", "bug"),
      false,
      "different worktree bug block",
    );
  });
  console.log("  ✓ bug blocks use separate dedup key from commit blocks");
});

test("testUtcStampMatchesSqliteFormat", () => {
  assert.strictEqual(
    utcStamp(new Date("2026-09-14T10:03:02.457Z")),
    "2026-09-14 10:03:02",
  );
});

test("testStopPayloadsMapToSameDecision", () => {
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

  // Same facts through either wire format → the same decision.
  const claudeReason = decideStop({
    stopHookActive: claude.stopHookActive,
    worktree: "/repo",
    commits: 2,
    memLastTs: "2026-09-15T00:00:00Z",
    since: "2026-09-20T00:00:00Z",
  });
  const cursorReason = decideStop({
    stopHookActive: cursor.stopHookActive,
    worktree: "/repo",
    commits: 2,
    memLastTs: "2026-09-15T00:00:00Z",
    since: "2026-09-20T00:00:00Z",
  });
  assert.ok(
    claudeReason,
    "commits with no new mem must block via the claude payload",
  );
  assert.ok(
    cursorReason,
    "commits with no new mem must block via the cursor payload",
  );
  assert.equal(claudeReason, cursorReason);
});

test("testCursorPayloadEdges", () => {
  const fired = normalizeStopInput(
    { ...cursorPayload, loop_count: 1 },
    "/home/u",
  );
  assert.ok(fired.stopHookActive);
  assert.strictEqual(
    decideStop({ ...base, stopHookActive: fired.stopHookActive }),
    null,
  );

  const withPath = normalizeStopInput(
    { ...cursorPayload, transcript_path: "/tmp/t.jsonl" },
    "/home/u",
  );
  assert.equal(withPath.transcriptPath, "/tmp/t.jsonl");

  assert.equal(
    cursorTranscriptPath("/home/u", "/Users/x/Proj/y", "c9"),
    "/home/u/.cursor/projects/Users-x-Proj-y/agent-transcripts/c9/c9.jsonl",
  );
});

test("testStopOutputShapesPerClient", () => {
  const reason = "record a mem row";
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
});

test("testCodexPayloadDetection", () => {
  assert.ok(isCodexPayload(codexPayload), "codex payload must be detected");
  assert.ok(
    !isCodexPayload(claudePayload),
    "claude payload must not look codex",
  );
  assert.ok(
    !isCodexPayload(cursorPayload),
    "cursor payload must not look codex",
  );
  assert.ok(
    isCodexPayload({ permission_mode: "default" }),
    "permission_mode alone detects codex",
  );
  assert.ok(isCodexPayload({ model: "gpt-5" }), "model alone detects codex");
  assert.ok(
    !isCodexPayload({ model: "gpt-5", workspace_roots: ["/repo"] }),
    "model + workspace_roots = cursor, not codex",
  );
  console.log("  ✓ codex payload detection");
});

test("testCodexNormalizeMapsToSameDecision", () => {
  const codex = normalizeStopInput(codexPayload, "/home/u");
  assert.equal(codex.client, "codex");
  assert.equal(codex.cwd, "/repo");
  assert.equal(
    codex.transcriptPath,
    "/repo/.codex/transcripts/sess-codex-1.jsonl",
  );
  assert.ok(!codex.stopHookActive);

  const reason = decideStop({
    stopHookActive: codex.stopHookActive,
    worktree: "/repo",
    commits: 2,
    memLastTs: "2026-09-15T00:00:00Z",
    since: "2026-09-20T00:00:00Z",
  });
  assert.ok(reason, "commits with no new mem must block via the codex payload");
  assert.ok(reason.includes("/repo"));
});

test("testCodexStopHookActiveAllows", () => {
  const fired = normalizeStopInput(
    { ...codexPayload, stop_hook_active: true },
    "/home/u",
  );
  assert.ok(fired.stopHookActive);
  assert.strictEqual(
    decideStop({ ...base, stopHookActive: fired.stopHookActive }),
    null,
  );
  console.log("  ✓ codex stop_hook_active=true allows");
});

test("testCodexStopOutputShape", () => {
  const reason = "record a mem row";
  const out = JSON.parse(stopOutput("codex", reason)) as Record<
    string,
    unknown
  >;
  assert.equal(out.decision, "block");
  assert.equal(out.reason, reason);
  assert.equal(out.continue, undefined, "codex must not use continue:false");
  assert.equal(out.stopReason, undefined, "codex must not use stopReason");
  assert.equal(out.followup_message, undefined, "codex must not use followup");
  console.log("  ✓ codex stop output = decision:block + reason");
});
