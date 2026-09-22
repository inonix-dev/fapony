import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMIT_HINT_MIN_COMMITS,
  capContext,
  commitHintFor,
  computeHintImpact,
  cursorTranscriptPath,
  decideStop,
  editHintFor,
  editTrackPath,
  isCodexPayload,
  isCursorPayload,
  mvGuardDecision,
  normalizeStopInput,
  READ_HINT_MIN_BYTES,
  readHintFor,
  readTrackPath,
  recordHintFire,
  rereadHintFor,
  SESSION_START_MAX_CHARS,
  sessionKey,
  stopBlockedBefore,
  stopBlockPath,
  stopOutput,
  utcStamp,
} from "../src/hook.js";
import {
  commitHintPluginSource,
  editHintPluginSource,
  readHintPluginSource,
  sessionStartPluginSource,
} from "../src/install/opencode.js";

const base = {
  stopHookActive: false,
  worktree: "/repo",
  commits: 2,
  memLastTs: "2026-09-15T00:00:00Z",
  since: "2026-09-20T00:00:00Z",
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
  assert(reason, "commits with no new mem row must block");
  assert(reason.includes("/repo"), "reason must name the absolute worktree");
  assert(
    reason.includes("mem add"),
    "reason must name the mem command the agent has to make",
  );
}

export function testDecideStopReportsCommitsAndMem(): void {
  // The block message carries the commit list and the mem status.
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
}

// Regression 2026-09-21: a monorepo whose only log lives in apps/<x> got
// "no rows at all — nothing recorded in this project yet" on every block,
// which is false. Out of scope and absent must read differently.
export function testDecideStopNamesOutOfScopeMemLog(): void {
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
}

// The first block delivers the message; blocks 2-5 in the same session deliver
// noise. stop_hook_active only covers the turn immediately after a block.
export function testStopBlocksOncePerSessionPerWorktree(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-sb-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
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
    assert.ok(existsSync(stopBlockPath(session)));
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ Stop blocks once per session + worktree");
}

// SessionStart context is injected whole — a repo with a long open list must
// not push the session's own prompt out of the way.
export function testSessionStartContextIsCapped(): void {
  const short = "one line";
  assert.equal(capContext(short), short, "short output passes through");
  const long = `${"x".repeat(50)}\n`.repeat(200);
  const capped = capContext(long);
  assert.ok(capped.length <= SESSION_START_MAX_CHARS + 120, "stays near cap");
  assert.ok(capped.includes("truncated"), "says it was cut");
  assert.ok(
    capped.includes("fapony mem find"),
    "points at capped recall, not the full dump",
  );
  assert.ok(
    !capped.includes("mem kickoff"),
    "never sends the agent back to the uncapped dump",
  );
  // The actionable section is the last one — a plain head-cut would drop it.
  const withNext = `${long}\n## next up\n  [1] bug #abc — fix the thing\n`;
  const keptNext = capContext(withNext);
  assert.ok(keptNext.includes("[1] bug #abc"), "keeps the next-up section");
  assert.ok(keptNext.includes("truncated"), "still says it was cut");
  assert.ok(
    keptNext.length <= SESSION_START_MAX_CHARS + 200,
    "keeping next up stays within budget",
  );
  console.log("  ✓ session-start context is capped with an honest marker");
}

export function testHookSessionStartSilentWithoutMemLog(): void {
  // Bug mub2ezhi: the no-mem-log guard is the whole reason the OpenCode plugin
  // now spawns this hook instead of `mem kickoff` — kickoff exits 0 and prints
  // "# <path> — 0 entries" in a repo with no log, and that header was landing
  // in the first dispatch of every session. Silence must be a clean exit with
  // zero stdout, because whatever lands here is injected as session context.
  withTempRepo((dir) => {
    const p = Bun.spawnSync(
      ["bun", join(import.meta.dir, "..", "fapony.ts"), "hook-session-start"],
      {
        cwd: dir,
        stdin: Buffer.from(JSON.stringify({ cwd: dir })),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FAPONY_STATE_DIR: join(dir, ".state") },
      },
    );
    assert.equal(p.exitCode, 0, "silence is a clean exit, not an error");
    assert.equal(p.stdout.toString().trim(), "", "no mem log = no context");
  });

  // The same hook emits the documented SessionStart JSON once a log exists.
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
    const row = JSON.stringify({
      ts: "2026-09-17T00:00:00Z",
      agent: "t",
      kind: "note",
      text: "remember this",
      files: ["README.md"],
    });
    writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${row}\n`);
    const p = Bun.spawnSync(
      ["bun", join(import.meta.dir, "..", "fapony.ts"), "hook-session-start"],
      {
        cwd: dir,
        stdin: Buffer.from(JSON.stringify({ cwd: dir })),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FAPONY_STATE_DIR: join(dir, ".state") },
      },
    );
    assert.equal(p.exitCode, 0);
    const out = JSON.parse(p.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.ok(
      typeof out.hookSpecificOutput.additionalContext === "string" &&
        out.hookSpecificOutput.additionalContext.length > 0,
      "carries the kickoff context",
    );
  });
  console.log("  ✓ hook-session-start: silent with no mem log, JSON with one");
}

export function testDecideStopMessageIsRepoNeutral(): void {
  // The block message installs globally and fires in every repo — a repo-specific
  // command in it teaches agents the message is untrustworthy.
  const reason = decideStop(base);
  assert(reason);
  assert.doesNotMatch(
    reason,
    /bun fapony\.ts|fapony lint-baseline|npm (run|test|exec)|pnpm |npx |yarn /,
    "block message must not name repo-specific commands",
  );
}

export function testDecideStopDerivesCommandFromWorktree(): void {
  // When the worktree is real, the message names the repo's actual test
  // command — not a generic phrase, not a hardcoded fapony one. derive, don't
  // assume: this is the whole point of detectTestRunner.
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
}

const REPO_SPECIFIC_CMDS =
  /bun fapony\.ts|npm (run test|test|exec)|pnpm test|yarn test/;

export function testStopHookSourceHasNoRepoSpecificCommands(): void {
  // The Stop hook installs globally but fires in every repo. Its source must
  // not hardcode a verify command that only works in one repo —
  // detectTestRunner owns derivation now. Sweep the files that build the block
  // message so the third occurrence of this bug class is caught at commit time,
  // not in someone's worktree. (Informational CLI refs like "fapony report" in
  // a setup banner are global commands, not verify commands — allowed.)
  for (const file of ["hook.ts", "setup.ts"]) {
    const src = readFileSync(join(__dirname, "..", "src", file), "utf-8");
    const bad = src.match(REPO_SPECIFIC_CMDS);
    assert.ok(
      !bad,
      `${file} hardcodes repo-specific verify command: "${bad?.[0]}" — derive via detectTestRunner`,
    );
  }
  console.log(
    "  ✓ hook.ts / setup.ts source sweeps clean (no hardcoded repo verify commands)",
  );
}

export function testDecideStopMemBlocksWhenStale(): void {
  // PLAN-verdict-to-mem: mem rows ARE the block condition now. A stale mem row
  // (older than session start) means no mem was recorded for this session's work.
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
}

export function testDecideStopComparesProductionTimestampShapes(): void {
  // Production sends mixed shapes: since is utcStamp ('YYYY-MM-DD HH:MM:SS',
  // no TZ) while mem rows are ISO. String comparison reads 'T' > ' ' and lets
  // any same-date row pass as "newer" — the second session of the day would
  // never block. Compare as dates instead.
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
}

export function testDecideStopAllowsEveryUnknown(): void {
  // Each of these must resolve to allow — a hook that guesses wrong traps
  // the agent, so anything it cannot prove is treated as "nothing to record".
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
}

// --- Codex hook contract ---

// https://learn.chatgpt.com/docs/hooks — Codex Stop payload
const codexPayload = {
  cwd: "/repo",
  session_id: "sess-codex-1",
  transcript_path: "/repo/.codex/transcripts/sess-codex-1.jsonl",
  stop_hook_active: false,
  hook_event_name: "Stop",
  model: "gpt-5",
  permission_mode: "default",
};

export function testCodexPayloadDetection(): void {
  assert.ok(isCodexPayload(codexPayload), "codex payload must be detected");
  assert.ok(
    !isCodexPayload(claudePayload),
    "claude payload must not look codex",
  );
  assert.ok(
    !isCodexPayload(cursorPayload),
    "cursor payload must not look codex",
  );
  // permission_mode alone is enough
  assert.ok(
    isCodexPayload({ permission_mode: "default" }),
    "permission_mode alone detects codex",
  );
  // model alone (without cursor fields) detects codex
  assert.ok(isCodexPayload({ model: "gpt-5" }), "model alone detects codex");
  // model + cursor fields = cursor wins (cursor is checked first)
  assert.ok(
    !isCodexPayload({ model: "gpt-5", workspace_roots: ["/repo"] }),
    "model + workspace_roots = cursor, not codex",
  );
  console.log("  ✓ codex payload detection");
}

export function testCodexNormalizeMapsToSameDecision(): void {
  const codex = normalizeStopInput(codexPayload, "/home/u");
  assert.equal(codex.client, "codex");
  assert.equal(codex.cwd, "/repo");
  assert.equal(
    codex.transcriptPath,
    "/repo/.codex/transcripts/sess-codex-1.jsonl",
  );
  assert.ok(!codex.stopHookActive);

  // Same facts → same decideStop result regardless of wire format.
  const reason = decideStop({
    stopHookActive: codex.stopHookActive,
    worktree: "/repo",
    commits: 2,
    memLastTs: "2026-09-15T00:00:00Z",
    since: "2026-09-20T00:00:00Z",
  });
  assert.ok(reason, "commits with no new mem must block via the codex payload");
  assert.ok(reason.includes("/repo"));
}

export function testCodexStopHookActiveAllows(): void {
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
}

export function testCodexStopOutputShape(): void {
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
    // The fixture exports `entry`, so the hint must carry the outline with
    // its line number — not the old measured-description fallback. (The
    // previous /\d+ lines\n/ matched the hint's own first line, so it passed
    // with or without an outline.)
    assert.match(hint ?? "", /\n.*entry:\d+/);
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

// --- Re-read hint (mtime heuristic — annotate only) ---

export function testRereadHintFiresOnUnchangedRepeat(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-rr-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    const p = join(dir, "small.ts");
    writeFileSync(p, "export const x = 1;\n");
    const session = "/tmp/transcripts/sess-a.jsonl";
    assert.equal(
      sessionKey(session),
      "sess-a",
      "key is the transcript basename",
    );
    // first full read: records, stays silent
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      null,
      "first read must stay silent",
    );
    // second read, unchanged content, same session = the hint
    const hint = rereadHintFor({ filePath: p, cwd: dir, session });
    assert.ok(hint, "second unchanged read must hint");
    assert.match(hint ?? "", /already read small\.ts 1\u00d7/);
    assert.match(hint ?? "", /grep the line range/);
    // one log per session — a different session sees nothing
    assert.equal(
      rereadHintFor({
        filePath: p,
        cwd: dir,
        session: "/tmp/transcripts/sess-b.jsonl",
      }),
      null,
      "no cross-session leak",
    );
    // a bounded read is already cheap — never tracked
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session, limit: 5 }),
      null,
      "bounded read must stay silent",
    );
    // a partial read (offset) is never tracked
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session, offset: 2 }),
      null,
      "offset read must stay silent",
    );
    assert.ok(existsSync(readTrackPath(session)), "read log must be written");
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ re-read hint fires on an unchanged repeat, per session");
}

export function testRereadHintSilentAfterEdit(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-rr-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    const p = join(dir, "edit.ts");
    writeFileSync(p, "export const x = 1;\n");
    const session = "sess-edit";
    assert.equal(rereadHintFor({ filePath: p, cwd: dir, session }), null);
    // change content and force a distinct mtime (same-ms writes are possible)
    writeFileSync(p, "export const x = 2;\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(p, later, later);
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      null,
      "mtime moved = new content = stay silent",
    );
    // the read that recorded the new mtime makes the next one a hit
    assert.ok(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      "unchanged since the new mtime must hint",
    );
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ re-read hint stays silent after the file changes");
}

export function testRereadHintKillSwitch(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-rr-"));
  const origState = process.env.FAPONY_STATE_DIR;
  const origKill = process.env.FAPONY_NO_REREAD_HINT;
  process.env.FAPONY_STATE_DIR = dir;
  process.env.FAPONY_NO_REREAD_HINT = "1";
  try {
    const p = join(dir, "k.ts");
    writeFileSync(p, "export const x = 1;\n");
    const session = "sess-kill";
    assert.equal(rereadHintFor({ filePath: p, cwd: dir, session }), null);
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      null,
      "kill switch = always silent",
    );
    assert.ok(
      !existsSync(readTrackPath(session)),
      "kill switch must not write the log",
    );
  } finally {
    if (origState === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = origState;
    if (origKill === undefined) delete process.env.FAPONY_NO_REREAD_HINT;
    else process.env.FAPONY_NO_REREAD_HINT = origKill;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ re-read hint kill switch silences and stops tracking");
}

// --- Edit hint (importer count + once-per-session dedupe) ---

function editFixture(dir: string): {
  lib: string;
  top: string;
  lone: string;
} {
  const lib = join(dir, "lib.ts");
  writeFileSync(lib, "export const value = 1;\n");
  writeFileSync(
    join(dir, "mid.ts"),
    'import { value } from "./lib.js";\nimport { top } from "./top.js";\nconsole.log(value, top);\n',
  );
  writeFileSync(
    join(dir, "top.ts"),
    'import { value } from "./lib.js";\nexport const top = value + 1;\n',
  );
  const lone = join(dir, "lone.ts");
  writeFileSync(lone, "export const alone = 1;\n");
  // lib ← mid, top (2 importers) · top ← mid (1 importer) · mid, lone ← nobody
  return { lib, top: join(dir, "top.ts"), lone };
}

/** Isolated FAPONY_STATE_DIR for the edit-track log; restored after. */
function withEditState(fn: () => void): void {
  const state = mkdtempSync(join(tmpdir(), "fapony-eh-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = state;
  try {
    fn();
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(state, { recursive: true, force: true });
  }
}

export function testEditHintFiresWithImporters(): void {
  withTempRepo((dir) => {
    withEditState(() => {
      const { lib } = editFixture(dir);
      const hint = editHintFor({
        filePath: lib,
        cwd: dir,
        session: "sess-eh-1",
      });
      assert.ok(hint, "file with importers must get a hint");
      assert.match(hint ?? "", /lib\.ts has 2 importers/);
      assert.match(hint ?? "", /review-seed --files lib\.ts/);
      assert.match(hint ?? "", /--callers/);
    });
  });
  console.log(
    "  ✓ edit hint names the importer count with review-seed pointer",
  );
}

export function testEditHintSilentZeroImporters(): void {
  withTempRepo((dir) => {
    withEditState(() => {
      const { lone } = editFixture(dir);
      const session = "sess-eh-zero";
      assert.equal(
        editHintFor({ filePath: lone, cwd: dir, session }),
        null,
        "file nobody imports must stay silent",
      );
      assert.ok(
        !existsSync(editTrackPath(session)),
        "zero-importer file must not write the track log",
      );
    });
  });
  console.log("  ✓ edit hint stays silent with 0 importers, writes nothing");
}

export function testEditHintSkipsNonSourceAndMissing(): void {
  withTempRepo((dir) => {
    withEditState(() => {
      editFixture(dir);
      const md = join(dir, "NOTES.md");
      writeFileSync(md, "x".repeat(READ_HINT_MIN_BYTES * 2));
      assert.equal(
        editHintFor({ filePath: md, cwd: dir, session: "s" }),
        null,
        "non-source ext must stay silent",
      );
      assert.equal(
        editHintFor({ filePath: join(dir, "new.ts"), cwd: dir, session: "s" }),
        null,
        "new/unsaved file must stay silent",
      );
      assert.equal(editHintFor({ filePath: null, cwd: dir }), null);
      assert.equal(editHintFor({ filePath: "", cwd: dir }), null);
      // a source file outside the worktree resolves to null, not a guess
      const outside = mkdtempSync(join(tmpdir(), "fapony-eh-out-"));
      try {
        const op = join(outside, "o.ts");
        writeFileSync(op, "export const o = 1;\n");
        assert.equal(
          editHintFor({ filePath: op, cwd: dir, session: "s" }),
          null,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
  console.log("  ✓ edit hint skips non-source, new, missing, outside files");
}

export function testEditHintNeedsGitRepo(): void {
  // Outside a repo the hint would point at a command that cannot run.
  const dir = mkdtempSync(join(tmpdir(), "fapony-eh-norepo-"));
  try {
    const p = join(dir, "a.ts");
    writeFileSync(p, "export const x = 1;\n");
    withEditState(() => {
      assert.equal(editHintFor({ filePath: p, cwd: dir, session: "s" }), null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ edit hint stays silent outside a git repo");
}

export function testEditHintDedupesPerSessionPerFile(): void {
  withTempRepo((dir) => {
    withEditState(() => {
      const { lib, top } = editFixture(dir);
      const s1 = "sess-eh-a";
      const s2 = "sess-eh-b";
      assert.ok(
        editHintFor({ filePath: lib, cwd: dir, session: s1 }),
        "first edit fires",
      );
      assert.equal(
        editHintFor({ filePath: lib, cwd: dir, session: s1 }),
        null,
        "repeat edit of the same file in the same session stays silent",
      );
      assert.ok(
        editHintFor({ filePath: lib, cwd: dir, session: s2 }),
        "no cross-session leak",
      );
      assert.ok(
        editHintFor({ filePath: top, cwd: dir, session: s1 }),
        "dedupe is per file, not per session",
      );
      assert.equal(
        editHintFor({ filePath: top, cwd: dir, session: s1 }),
        null,
        "second file also dedupes on repeat",
      );
    });
  });
  console.log("  ✓ edit hint fires once per (session, file)");
}

export function testEditHintFiresWithoutSession(): void {
  // No session identity = nothing to dedupe against, but the importer fact
  // still holds — the hint fires rather than guessing silence.
  withTempRepo((dir) => {
    withEditState(() => {
      const { lib } = editFixture(dir);
      assert.ok(editHintFor({ filePath: lib, cwd: dir }), "fires");
      assert.ok(
        editHintFor({ filePath: lib, cwd: dir }),
        "fires again with no session to dedupe against",
      );
    });
  });
  console.log("  ✓ edit hint fires (no dedupe) when the session is unknown");
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
        env: { ...process.env, FAPONY_STATE_DIR: dir },
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

export function testEditHintClaudeOutputShape(): void {
  // cmdHookEditHint is a thin wrapper; assert the pure core feeds the
  // documented additionalContext shape via the real stdin/stdout path,
  // and that a fire logs one "edit" surface row.
  withTempRepo((dir) => {
    const lib = join(dir, "lib.ts");
    writeFileSync(lib, "export const value = 1;\n");
    writeFileSync(
      join(dir, "mid.ts"),
      'import { value } from "./lib.js";\nconsole.log(value);\n',
    );
    const run = (payload: unknown) =>
      Bun.spawnSync(
        ["bun", join(import.meta.dir, "..", "fapony.ts"), "hook-edit-hint"],
        {
          cwd: dir,
          stdin: Buffer.from(JSON.stringify(payload)),
          stdout: "pipe",
          env: { ...process.env, FAPONY_STATE_DIR: dir },
        },
      );
    const session = join(dir, "sess-eh.jsonl");
    const first = run({
      cwd: dir,
      transcript_path: session,
      tool_input: { file_path: lib },
    });
    const out = JSON.parse(first.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(
      out.hookSpecificOutput.additionalContext ?? "",
      /lib\.ts has 1 importer/,
    );
    assert.match(
      out.hookSpecificOutput.additionalContext ?? "",
      /review-seed --files lib\.ts/,
    );
    assert.ok(
      !JSON.stringify(out).includes("permissionDecision"),
      "annotate-only: no permissionDecision may ever appear",
    );
    // one "edit" surface row in the hint log
    let logFiles: string[] = [];
    try {
      logFiles = readdirSync(join(dir, "hint-log")).filter((f) =>
        f.endsWith(".jsonl"),
      );
    } catch {
      logFiles = [];
    }
    assert.equal(logFiles.length, 1, "exactly one worktree log file");
    const rows = readFileSync(join(dir, "hint-log", logFiles[0]), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].surface, "edit");
    assert.equal(rows[0].file, "lib.ts");
    // repeat edit in the same session: dedupe → no output, no second row
    const second = run({
      cwd: dir,
      transcript_path: session,
      tool_input: { file_path: lib },
    });
    assert.equal(
      second.stdout.toString().trim(),
      "",
      "repeat edit stays silent",
    );
    const rowsAfter = readFileSync(join(dir, "hint-log", logFiles[0]), "utf-8")
      .split("\n")
      .filter(Boolean);
    assert.equal(rowsAfter.length, 1, "dedupe must not log a second row");
    // zero-importer file: silent, no new row
    const lone = join(dir, "lone.ts");
    writeFileSync(lone, "export const alone = 1;\n");
    const third = run({
      cwd: dir,
      transcript_path: session,
      tool_input: { file_path: lone },
    });
    assert.equal(
      third.stdout.toString().trim(),
      "",
      "0 importers stays silent",
    );
  });
  console.log("  ✓ edit hint claude output = additionalContext + edit log row");
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
  assert.ok(
    src.includes("readContextData"),
    "must also wire debt/mem context, matching Claude's cmdHookReadHint",
  );
  // The fire-log must resolve a relative path against `directory` (the cwd the
  // hook was handed), not the worktree — a subdir launch must still attribute
  // the row instead of logging file:null.
  assert.ok(
    src.includes("pjoin(directory, filePath)"),
    "fire-log joins against directory, not worktree",
  );
  console.log(
    "  ✓ read hint opencode plugin imports shared logic, annotate-only",
  );
}

// --- Debt + mem context lines (PLAN-convention-debt chunk 4) ---

import { readContextLines } from "../src/hook.js";

export function testReadContextShowsDebtBeforeFix(): void {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          {
            id: "mutation-hooks",
            rule: "use useAppForm instead of raw useMutation",
            where: "src",
            stale: "\\buseMutation\\(",
            checker: null,
          },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    const p = join(dir, "src", "dirty.ts");
    writeFileSync(p, "export const m = () => useMutation(fn);\n");
    const lines = readContextLines(p, dir);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /fapony debt: \[mutation-hooks\]/);
    // a clean file stays completely silent
    const clean = join(dir, "src", "clean.ts");
    writeFileSync(clean, "export const ok = 1;\n");
    assert.deepEqual(readContextLines(clean, dir), []);
  });
  console.log(
    "  ✓ read context → debt line before the fix, silence on clean files",
  );
}

export function testReadContextMemRowsByFilesAndPath(): void {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    const row = (ts: string, text: string, files?: string[]) =>
      JSON.stringify({
        ts,
        agent: "t",
        kind: "bug",
        text,
        ...(files ? { files } : []),
      });
    const logRows = [
      row("2026-09-17T00:00:00Z", "money drifted via toLocaleString", [
        "src/bill.tsx",
      ]),
      row("2026-09-16T00:00:00Z", "old row mentions src/form.tsx by path"),
      row("2026-09-15T00:00:00Z", "unrelated row about nothing"),
    ].join("\n");
    writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${logRows}\n`);
    writeFileSync(join(dir, "src/bill.tsx"), "x");
    writeFileSync(join(dir, "src/form.tsx"), "x");
    const byFiles = readContextLines(join(dir, "src/bill.tsx"), dir);
    assert.equal(byFiles.length, 1);
    assert.match(byFiles[0], /fapony mem: 2026-09-17 bug/);
    const byPath = readContextLines(join(dir, "src/form.tsx"), dir);
    assert.equal(
      byPath.length,
      1,
      "old rows without files[] still match by full path",
    );
    assert.match(byPath[0], /2026-09-16/);
    const none = readContextLines(join(dir, "src/other.tsx"), dir);
    assert.deepEqual(none, [], "unmentioned file stays silent");
  });
  console.log("  ✓ read context → mem rows surface by files[] or full path");
}

export function testReadContextBasenameAmbiguityStaysSilent(): void {
  withTempRepo((dir) => {
    mkdirSync(join(dir, "src/a"), { recursive: true });
    mkdirSync(join(dir, "src/b"), { recursive: true });
    mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
    writeFileSync(join(dir, "src/a/index.ts"), "x");
    writeFileSync(join(dir, "src/b/index.ts"), "x");
    const memRow = JSON.stringify({
      ts: "2026-09-17T00:00:00Z",
      agent: "t",
      kind: "note",
      text: "watch out for index.ts",
    });
    writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${memRow}\n`);
    // two index.ts exist — the row cannot be attributed, so: silence
    const lines = readContextLines(join(dir, "src/a/index.ts"), dir);
    assert.equal(lines.length, 0, "ambiguous basename must not guess");
  });
  console.log(
    "  ✓ read context → ambiguous basename stays silent, never guesses",
  );
}

export function testReadContextCombinedCapAndOutsideRepo(): void {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          { id: "a", rule: "r1", where: "src", stale: "aaa", checker: null },
          { id: "b", rule: "r2", where: "src", stale: "bbb", checker: null },
          { id: "c", rule: "r3", where: "src", stale: "ccc", checker: null },
          { id: "d", rule: "r4", where: "src", stale: "ddd", checker: null },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/all.ts"), "aaa bbb ccc ddd\n");
    const lines = readContextLines(join(dir, "src/all.ts"), dir);
    assert.ok(
      lines.length <= 5,
      `total context lines capped, got ${lines.length}`,
    );
    assert.equal(lines.filter((l) => l.startsWith("fapony debt")).length, 3);
    // outside a git repo → nothing
    const out = mkdtempSync(join(tmpdir(), "fapony-ctx-norepo-"));
    try {
      writeFileSync(join(out, "f.ts"), "aaa bbb ccc ddd\n");
      assert.deepEqual(readContextLines(join(out, "f.ts"), out), []);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  console.log("  ✓ read context → ≤5 lines, silent outside a repo");
}

// --- Commit hint (tool.execute.after annotate-only) ---

import { execSync } from "node:child_process";

export function testCommitHintNullForNonCommit(): void {
  assert.strictEqual(
    commitHintFor({ command: "git push origin main", cwd: "/tmp" }),
    null,
    "git push must not trigger the hint",
  );
  assert.strictEqual(
    commitHintFor({ command: "git status", cwd: "/tmp" }),
    null,
    "git status must not trigger the hint",
  );
  assert.strictEqual(
    commitHintFor({ command: "", cwd: "/tmp" }),
    null,
    "empty command must not trigger the hint",
  );
  assert.strictEqual(
    commitHintFor({ command: null, cwd: "/tmp" }),
    null,
    "null command must not trigger the hint",
  );
  console.log("  ✓ commit hint → silent for non-commit bash commands");
}

export function testCommitHintNullOutsideGitRepo(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-norepo-"));
  try {
    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.strictEqual(hint, null, "outside a git repo must be silent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → silent outside a git repo");
}

export function testCommitHintSilentWithoutMemLog(): void {
  // No mem log = no window to measure — the hint stays silent instead of
  // listing the entire repo history (the frozen-verdict bug this replaced).
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });

    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.strictEqual(hint, null, "no mem log = no window = silent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → silent with no mem log to window on");
}

function writeTempMemRow(dir: string, ts: string): void {
  mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
  const row = JSON.stringify({
    ts,
    agent: "t",
    kind: "note",
    text: "test row",
    files: ["README.md"],
  });
  writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${row}\n`);
}

export function testCommitHintFiresForCommitsSinceMemRow(): void {
  // A mem row older than the repo's commits windows the hint to just those.
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
    writeTempMemRow(dir, "2020-01-01T00:00:00.000Z");

    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.ok(hint, "must nudge for commits newer than the last mem row");
    assert.ok(hint.includes("fapony:"), "hint must be prefixed with fapony:");
    assert.ok(hint.includes("mem add"), "hint must name the mem add command");
    assert.ok(
      hint.includes("since last mem row"),
      "window must read as mem rows, not verdicts",
    );
    assert.doesNotMatch(hint, /verdict/i, "verdict wording must be gone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → fires for commits newer than the mem row");
}

export function testCommitHintSilentWhenMemRowCoversCommits(): void {
  // A mem row newer than every commit means nothing is unrecorded.
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
    writeTempMemRow(dir, new Date(Date.now() + 3600_000).toISOString());

    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.strictEqual(
      hint,
      null,
      "must be silent when the mem row covers all commits",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → silent when the mem row covers all commits");
}

export function testCommitHintPluginSource(): void {
  // The generated OpenCode plugin must import the shared commitHintFor
  // logic (no second implementation), target the bash tool, and mutate
  // output only.
  const src = commitHintPluginSource("/install/root");
  assert.ok(
    src.includes("/install/root/src/hook.ts"),
    "bakes the install root",
  );
  assert.ok(src.includes('input.tool !== "bash"'), "guards the bash tool");
  assert.ok(src.includes("output.output"), "mutates the tool output");
  assert.ok(!src.includes("throw"), "must never throw into the tool call");
  assert.ok(
    src.includes("commitHintFor"),
    "must import commitHintFor from the shared module",
  );
  console.log(
    "  ✓ commit hint opencode plugin imports shared logic, annotate-only",
  );
}

export function testEditHintPluginSource(): void {
  // The generated OpenCode plugin must import the shared editHintFor logic
  // (no second implementation), target the edit + write tools, mutate output
  // only, and log through the "edit" fire surface.
  const src = editHintPluginSource("/install/root");
  assert.ok(
    src.includes("/install/root/src/hook.ts"),
    "bakes the install root",
  );
  assert.ok(src.includes('input.tool !== "edit"'), "guards the edit tool");
  assert.ok(src.includes('input.tool !== "write"'), "guards the write tool");
  assert.ok(!src.includes("apply_patch"), "apply_patch stays out of scope");
  assert.ok(src.includes("output.output"), "mutates the tool output");
  assert.ok(!src.includes("throw"), "must never throw into the tool call");
  assert.ok(
    src.includes("editHintFor"),
    "must import editHintFor from the shared module",
  );
  assert.ok(
    src.includes('surface: "edit"'),
    "must log through the edit fire surface",
  );
  // Fire-log resolves a relative path against `directory`, not worktree, so a
  // subdir launch attributes the row instead of file:null.
  assert.ok(
    src.includes("pjoin(directory, filePath)"),
    "fire-log joins against directory, not worktree",
  );
  // The non-string output guard must run before editHintFor, or a hint that
  // cannot surface still spends the per-session dedupe row and logs a fire.
  const guard = src.indexOf('typeof output.output !== "string"');
  const call = src.indexOf("editHintFor({");
  assert.ok(
    guard >= 0 && call >= 0 && guard < call,
    "output guard must precede the editHintFor call",
  );
  console.log(
    "  ✓ edit hint opencode plugin imports shared logic, annotate-only",
  );
}

export function testCommitHintMinCommitsConstant(): void {
  assert.strictEqual(COMMIT_HINT_MIN_COMMITS, 1);
  console.log("  ✓ commit hint min commits constant is 1");
}

export function testSessionStartPluginSource(): void {
  // The generated OpenCode plugin must import the one sessionStartContext
  // implementation from src/hook.ts — guard + kickoff spawn + cap shared with
  // the Claude/Codex hooks, and updatable by `git pull` (not baked into the
  // body). It used to bake `mem kickoff` and push stdout, which injected the
  // empty-repo "# <path> — 0 entries" header into every session (mub2ezhi).
  const src = sessionStartPluginSource("/install/root");
  assert.ok(
    src.includes("/install/root/src/hook.ts"),
    "imports the shared hook module",
  );
  assert.ok(src.includes("/install/root/fapony.ts"), "bakes the CLI path");
  assert.ok(
    src.includes("experimental.chat.system.transform"),
    "injects via system.transform, the documented channel",
  );
  assert.ok(
    src.includes("sessionStartContext"),
    "calls the shared implementation, no baked logic",
  );
  assert.ok(
    !src.includes("spawnSync"),
    "no baked spawn — sessionStartContext owns the guard and the cap",
  );
  assert.ok(!src.includes("capContext"), "no second cap");
  assert.ok(src.includes("output.system"), "pushes into system, never args");
  assert.ok(
    src.includes("sessionID") && src.includes("seen"),
    "dedupes once per session",
  );
  assert.ok(!src.includes("throw"), "must never break a session start");
  console.log(
    "  ✓ session start opencode plugin defers to sessionStartContext",
  );
}

export function testComputeHintImpact(): void {
  withTempRepo((dir) => {
    // Set up conventions + a violating file.
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          {
            id: "no-use-mutation",
            rule: "use useAppForm instead of raw useMutation",
            where: "src",
            stale: "\\buseMutation\\(",
            checker: null,
          },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    const p = join(dir, "src", "dirty.ts");
    writeFileSync(p, "export const m = () => useMutation(fn);\n");

    // Write a hint-fire log row manually (simulating what cmdHookReadHint does).
    process.env.FAPONY_STATE_DIR = dir;
    try {
      recordHintFire({
        ts: new Date().toISOString(),
        worktree: dir,
        surface: "debt",
        file: "src/dirty.ts",
        count: 1,
        ids: ["no-use-mutation"],
      });

      // Before fix: 1 shown, 0 resolved (still violating).
      const before = computeHintImpact();
      assert.equal(before.fired, 1);
      assert.equal(before.debt.shown, 1);
      assert.equal(before.debt.resolved, 0);

      // Fix the violation.
      writeFileSync(p, "export const ok = 1;\n");

      // After fix: 1 shown, 1 resolved.
      const after = computeHintImpact();
      assert.equal(after.debt.shown, 1);
      assert.equal(after.debt.resolved, 1);
    } finally {
      delete process.env.FAPONY_STATE_DIR;
    }
  });
  console.log("  ✓ computeHintImpact: debt precision counts resolved ids");
}

export function testComputeHintImpactNoLog(): void {
  process.env.FAPONY_STATE_DIR = mkdtempSync(join(tmpdir(), "fapony-no-log-"));
  try {
    const impact = computeHintImpact();
    assert.equal(impact.fired, 0);
    assert.equal(impact.debt.shown, 0);
  } finally {
    delete process.env.FAPONY_STATE_DIR;
  }
  console.log("  ✓ computeHintImpact: no log → zero counts, no error");
}

export function testMvGuardDeniesPlanIntoDone(): void {
  assert.ok(
    mvGuardDecision("git mv .fapony/plan/PLAN-alerts.md .fapony/plan/done/"),
    "nested plan/done/ mistake is denied",
  );
  assert.ok(
    mvGuardDecision(
      "git mv apps/vela/.fapony/plan/PLAN-x.md apps/vela/.fapony/done/",
    ),
    "correct sibling done/ is still denied — plan-sweep is the required path",
  );
  const reason = mvGuardDecision(
    "git mv .fapony/plan/PLAN-alerts.md .fapony/done/",
  );
  assert.match(
    reason ?? "",
    /plan-sweep --apply \.fapony\/plan\/PLAN-alerts\.md/,
  );
  console.log("  ✓ mvGuardDecision denies raw git mv of a plan into done/");
}

export function testMvGuardAllowsEverythingElse(): void {
  assert.equal(mvGuardDecision(undefined), null);
  assert.equal(mvGuardDecision(""), null);
  assert.equal(mvGuardDecision("ls .fapony/plan"), null);
  assert.equal(
    mvGuardDecision("git mv src/old.ts src/new.ts"),
    null,
    "non-plan file mv is untouched",
  );
  assert.equal(
    mvGuardDecision("git mv .fapony/plan/PLAN-x.md .fapony/spec/"),
    null,
    "moving a plan somewhere that isn't done/ is untouched",
  );
  console.log(
    "  ✓ mvGuardDecision allows every command outside its one pattern",
  );
}

export function testMvGuardClaudeOutputShape(): void {
  withTempRepo((dir) => {
    const proc = Bun.spawnSync(
      ["bun", join(import.meta.dir, "..", "fapony.ts"), "hook-mv-guard"],
      {
        cwd: dir,
        stdin: Buffer.from(
          JSON.stringify({
            tool_input: {
              command: "git mv .fapony/plan/PLAN-x.md .fapony/done/",
            },
          }),
        ),
        stdout: "pipe",
      },
    );
    const out = JSON.parse(proc.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(
      out.hookSpecificOutput.permissionDecisionReason ?? "",
      /plan-sweep --apply/,
    );
  });
  console.log("  ✓ mv guard claude output = permissionDecision deny");
}
