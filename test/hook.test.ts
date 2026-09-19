import assert from "node:assert";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMIT_HINT_MIN_COMMITS,
  commitHintFor,
  computeHintImpact,
  cursorTranscriptPath,
  decideStop,
  isCursorPayload,
  normalizeStopInput,
  READ_HINT_MIN_BYTES,
  readHintFor,
  readTrackPath,
  recordHintFire,
  rereadHintFor,
  sessionKey,
  stopOutput,
  utcStamp,
} from "../src/hook.js";
import {
  commitHintPluginSource,
  readHintPluginSource,
} from "../src/install/opencode.js";

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
  console.log(
    "  ✓ read hint opencode plugin imports shared logic, annotate-only",
  );
}

// --- Debt + mem context lines (PLAN-convention-debt chunk 4) ---

import { mkdirSync } from "node:fs";
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
    writeFileSync(
      join(dir, ".fapony/.memory/log.t.jsonl"),
      [
        row("2026-09-17T00:00:00Z", "money drifted via toLocaleString", [
          "src/bill.tsx",
        ]),
        row("2026-09-16T00:00:00Z", "old row mentions src/form.tsx by path"),
        row("2026-09-15T00:00:00Z", "unrelated row about nothing"),
      ].join("\n") + "\n",
    );
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
    writeFileSync(
      join(dir, ".fapony/.memory/log.t.jsonl"),
      JSON.stringify({
        ts: "2026-09-17T00:00:00Z",
        agent: "t",
        kind: "note",
        text: "watch out for index.ts",
      }) + "\n",
    );
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
import { openDb } from "../src/db/index.js";

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

export function testCommitHintWhenNoGradedVerdicts(): void {
  // Create a git repo with a commit and no verdicts in the DB.
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

    // Set FAPONY_STATE_DIR so openDb() uses an isolated db.
    const orig = process.env.FAPONY_STATE_DIR;
    process.env.FAPONY_STATE_DIR = dir;
    try {
      const hint = commitHintFor({
        command: "git commit -m 'test'",
        cwd: dir,
      });
      assert.ok(hint, "must return a hint when commits have no verdicts");
      assert.ok(hint.includes("fapony:"), "hint must be prefixed with fapony:");
      assert.ok(
        hint.includes("verdict_submit"),
        "hint must name verdict_submit",
      );
    } finally {
      if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
      else process.env.FAPONY_STATE_DIR = orig;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → returns hint when ungraded commits exist");
}

export function testCommitHintWhenGradedVerdictsExist(): void {
  // Create a git repo + DB with a verdict, then check the hint is null.
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
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
    // commitHintFor resolves the worktree via `git rev-parse --show-toplevel`,
    // which canonicalizes symlinks (macOS: /tmp → /private/tmp) — the row
    // must be keyed on that same resolved path, not the raw mkdtemp path.
    const worktree = execSync("git rev-parse --show-toplevel", {
      cwd: dir,
    })
      .toString()
      .trim();

    const db = openDb();
    try {
      db.exec(`INSERT INTO runs (worktree, status) VALUES (?, 'passed')`, [
        worktree,
      ]);
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      const row = db
        .query(`SELECT id FROM runs WHERE worktree = ?`)
        .get(worktree) as { id: number } | null;
      if (row) {
        db.exec(`INSERT INTO events (run_id, kind) VALUES (?, 'gate')`, [
          row.id,
        ]);
        db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      }

      const hint = commitHintFor({
        command: "git commit -m 'test'",
        cwd: dir,
      });
      assert.strictEqual(
        hint,
        null,
        "must be silent when verdicts already exist",
      );
    } finally {
      db.close();
    }
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → silent when verdicts already exist");
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

export function testCommitHintMinCommitsConstant(): void {
  assert.strictEqual(COMMIT_HINT_MIN_COMMITS, 1);
  console.log("  ✓ commit hint min commits constant is 1");
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
