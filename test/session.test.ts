// test/session.test.ts — detail mode for readPassiveUsage (PLAN-usage-depth A1)

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginSnapshot, endSnapshot } from "../src/session/helpers.js";
import {
  mergeBytesByTool,
  readClaudeCodeUsage,
  readCodexUsage,
  readPassiveUsage,
  readZcodeUsage,
} from "../src/session/index.js";

function withFixtureDb(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-opencode-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    db.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL DEFAULT '', model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    db.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    db.run(`CREATE INDEX part_session_idx ON part (session_id)`);

    db.prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`).run(
      "p1",
      "/tmp/wt1",
    );
    const sess = db.prepare(
      `INSERT INTO session (id, project_id, directory, model, time_created, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // s1 ran in a git worktree UNDER the project root — OpenCode records the
    // root on `project`, the real cwd on `session.directory`.
    sess.run("s1", "p1", "/tmp/wt1/wt-sub", "m1", 1000, 100, 50, 0.01);
    sess.run("s2", "p1", "/tmp/wt1", "m1", 2000, 200, 60, 0.02);

    const part = db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, 1, 1, ?)`,
    );
    const tool = (t: string, extra = {}) =>
      JSON.stringify({ type: "tool", tool: t, ...extra });
    // s1: 2×read, 1×bash (with input/output blobs — must never leak), 2 steps
    part.run(
      "p-s1-1",
      "m1",
      "s1",
      tool("read", {
        state: { input: { filePath: "/secret" }, output: "file contents here" },
      }),
    );
    part.run("p-s1-2", "m1", "s1", tool("read"));
    part.run("p-s1-3", "m1", "s1", tool("bash"));
    part.run(
      "p-s1-4",
      "m1",
      "s1",
      JSON.stringify({
        type: "step-finish",
        tokens: { total: 19000 },
        cost: 0,
      }),
    );
    part.run(
      "p-s1-5",
      "m1",
      "s1",
      JSON.stringify({
        type: "step-finish",
        tokens: { total: 19500 },
        cost: 0,
      }),
    );
    // s2: 1×read, 1 step, 1 text part (unknown type → skip)
    part.run("p-s2-1", "m1", "s2", tool("read"));
    part.run(
      "p-s2-2",
      "m1",
      "s2",
      JSON.stringify({
        type: "step-finish",
        tokens: { total: 19000 },
        cost: 0,
      }),
    );
    part.run(
      "p-s2-3",
      "m1",
      "s2",
      JSON.stringify({ type: "text", text: "hello" }),
    );

    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function withEnvDb(dbPath: string, fn: () => void): void {
  const prev = process.env.FAPONY_OPENCODE_DB;
  process.env.FAPONY_OPENCODE_DB = dbPath;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prev;
  }
}

export function testSessionDefaultHasNoDetail(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage();
      assert.equal(r.session_count, 2);
      assert.equal(r.total_tokens_input, 300);
      assert.equal(r.detail, undefined, "default must not include detail");
    }),
  );
  console.log("  ✓ readPassiveUsage default has no detail (additive)");
}

export function testSessionWorktreeScopeUsesSessionDirectory(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      // project.worktree is the repo root; the run happened in a worktree under
      // it. Filtering on the project row found nothing and every per-project
      // usage row came back empty.
      const sub = readPassiveUsage("/tmp/wt1/wt-sub");
      assert.equal(sub.session_count, 1);
      assert.equal(sub.total_tokens_input, 100);
      const root = readPassiveUsage("/tmp/wt1");
      assert.equal(root.session_count, 1);
      assert.equal(root.total_tokens_input, 200);
    }),
  );
  console.log(
    "  \u2713 readPassiveUsage scopes by session.directory, not project root",
  );
}

export function testSessionDetailBreakdown(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      // Regression: totals identical with detail on
      assert.equal(r.session_count, 2);
      assert.equal(r.total_tokens_input, 300);
      assert.ok(r.detail, "detail:true must include detail");
      assert.deepEqual(r.detail.tool_breakdown, { read: 3, bash: 1 });
      assert.equal(r.detail.steps, 3);
      assert.equal(r.detail.by_session.length, 2);
      const s1 = r.detail.by_session.find((s) => s.session_id === "s1")!;
      assert.equal(s1.steps, 2);
      assert.deepEqual(s1.tools, { read: 2, bash: 1 });
      const s2 = r.detail.by_session.find((s) => s.session_id === "s2")!;
      assert.equal(s2.steps, 1);
      assert.deepEqual(s2.tools, { read: 1 });
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail: tool breakdown + steps per session",
  );
}

export function testSessionDetailBytesByTool(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      assert.ok(r.detail, "detail present");
      // Only s1's first read carried state.output ("file contents here" = 18
      // bytes); tools/steps without output contribute nothing.
      assert.deepEqual(r.detail!.bytes_by_tool, { read: 18 });
      console.log(
        "  ✓ readPassiveUsage detail → bytes_by_tool from state.output",
      );
    }),
  );
}

export function testSessionDetailSkipsUnknownType(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      // 'text' part in s2 must not appear anywhere in the breakdown
      const blob = JSON.stringify(r.detail);
      assert(!blob.includes("hello"), "unknown part content must not leak");
      assert(
        !blob.includes("file contents here"),
        "tool input/output must never be stored",
      );
      assert(!("text" in r.detail!.tool_breakdown), "text is not a tool");
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail skips unknown types, never stores I/O",
  );
}

export function testSessionDetailStepTokensNotSummed(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      // Step tokens overlap per step — must NOT be summed; only counts.
      const blob = JSON.stringify(r.detail);
      assert(!blob.includes("19000") && !blob.includes("19500"));
      assert(!blob.includes("57500"), "no step-token sum anywhere");
      assert(typeof r.detail!.note === "string" && r.detail!.note.length > 0);
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail reports step counts, never token sums",
  );
}

export function testSessionDetailMatchesRawSql(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const raw = new Database(dbPath, { readonly: true });
      try {
        const expected = raw
          .prepare(
            `SELECT json_extract(data,'$.tool') AS tool, COUNT(*) AS c FROM part WHERE json_extract(data,'$.type')='tool' GROUP BY tool ORDER BY c DESC`,
          )
          .all() as Array<{ tool: string; c: number }>;
        const r = readPassiveUsage(undefined, undefined, undefined, true);
        for (const e of expected) {
          assert.equal(
            r.detail!.tool_breakdown[e.tool],
            e.c,
            `tool ${e.tool} matches raw SQL`,
          );
        }
        const steps = raw
          .prepare(
            `SELECT COUNT(*) AS n FROM part WHERE json_extract(data,'$.type')='step-finish'`,
          )
          .get() as { n: number };
        assert.equal(r.detail!.steps, steps.n, "steps match raw SQL");
      } finally {
        raw.close();
      }
    }),
  );
  console.log("  ✓ readPassiveUsage detail cross-checks against raw SQL");
}

// --- zcode usage tests ---

function withZcodeFixtureDb(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-zcode-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      )`,
    );
    db.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0, cache_creation_input_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0, computed_total_tokens INTEGER DEFAULT 0
      )`,
    );
    db.run(
      `CREATE TABLE part (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL, time_created INTEGER NOT NULL
      )`,
    );

    db.prepare(
      `INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`,
    ).run("s1", "p1", "/tmp/zcode-wt", 1700000000, 1700000100);
    db.prepare(
      `INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`,
    ).run("s2", "p1", "/tmp/zcode-wt", 1700000200, 1700000300);
    db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m1", "s1", "claude-sonnet-5", 1000, 500, 200, 50, 30, 1780);
    db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m2", "s1", "claude-opus-5", 2000, 800, 400, 100, 60, 3560);
    db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m3", "s2", "claude-sonnet-5", 1500, 600, 300, 80, 40, 2620);
    db.prepare(
      `INSERT INTO part (id, session_id, data, time_created) VALUES (?, ?, ?, ?)`,
    ).run("p1", "s1", '{"type":"step-finish"}', 1700000050);
    db.prepare(
      `INSERT INTO part (id, session_id, data, time_created) VALUES (?, ?, ?, ?)`,
    ).run("p2", "s1", '{"type":"tool","tool":"Bash"}', 1700000060);

    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadZcodeUsageNoDb(): void {
  const orig = process.env.FAPONY_ZCODE_DB;
  try {
    // Point to a non-existent path so readZcodeUsage returns EMPTY_RESULT
    process.env.FAPONY_ZCODE_DB = "/nonexistent/zcode/db.sqlite";
    const result = readZcodeUsage();
    assert.equal(result.session_count, 0);
    assert.equal(result.total_tokens_input, 0);
    console.log("  ✓ readZcodeUsage no DB → empty result");
  } finally {
    if (orig === undefined) delete process.env.FAPONY_ZCODE_DB;
    else process.env.FAPONY_ZCODE_DB = orig;
  }
}

export function testReadZcodeUsagePrimaryPath(): void {
  withZcodeFixtureDb((dbPath) => {
    const orig = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = readZcodeUsage();
      assert.equal(
        result.session_count,
        2,
        `got ${result.session_count} sessions`,
      );
      assert.ok(result.total_tokens_input > 0);
      assert.ok(result.by_model.length > 0);
      const sonnet = result.by_model.find((m) => m.model === "claude-sonnet-5");
      assert.ok(sonnet, "claude-sonnet-5 found");
      assert.equal(sonnet!.tokens_input, 2500, "sonnet input tokens");
      console.log("  ✓ readZcodeUsage primary path → reads ZCode DB");
    } finally {
      if (orig === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = orig;
    }
  });
}

export function testReadZcodeUsageDetail(): void {
  withZcodeFixtureDb((dbPath) => {
    process.env.FAPONY_ZCODE_DB = dbPath;
    const result = readZcodeUsage(undefined, undefined, undefined, true);
    assert.ok(result.detail, "detail present");
    assert.ok(result.detail!.tool_breakdown.Bash >= 0);
    assert.ok(result.detail!.steps >= 0);
    console.log("  ✓ readZcodeUsage detail → tool_breakdown and steps");
    delete process.env.FAPONY_ZCODE_DB;
  });
}

export function testReadZcodeUsageFilterByWorktree(): void {
  withZcodeFixtureDb((dbPath) => {
    process.env.FAPONY_ZCODE_DB = dbPath;
    // Both sessions are in /tmp/zcode-wt — filter should return them
    const result = readZcodeUsage("/tmp/zcode-wt");
    assert.equal(result.session_count, 2);
    // Filter with non-existent worktree → empty
    const empty = readZcodeUsage("/nonexistent/wt");
    assert.equal(empty.session_count, 0);
    console.log("  ✓ readZcodeUsage filter by worktree");
    delete process.env.FAPONY_ZCODE_DB;
  });
}

// --- claude code usage tests ---

function withClaudeCodeFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-claude-code-"));
  const projectDir = join(dir, "projects", "-tmp-test-worktree");
  const { mkdirSync } = require("node:fs");
  mkdirSync(projectDir, { recursive: true });

  // Session 1: 2 usage lines, 2 models
  const session1 = [
    JSON.stringify({
      message: {
        model: "claude-sonnet-5",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 10,
          output_tokens_details: { thinking_tokens: 15 },
        },
      },
      timestamp: "2026-09-09T03:00:00.000Z",
      cwd: "/tmp/test-worktree",
    }),
    JSON.stringify({
      message: {
        model: "claude-opus-5",
        usage: {
          input_tokens: 200,
          output_tokens: 80,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 15,
          output_tokens_details: { thinking_tokens: 25 },
        },
      },
      timestamp: "2026-09-09T03:01:00.000Z",
      cwd: "/tmp/test-worktree",
    }),
  ].join("\n");

  // Session 2: 1 usage line
  const session2 = [
    JSON.stringify({
      message: {
        model: "claude-sonnet-5",
        usage: {
          input_tokens: 150,
          output_tokens: 60,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      timestamp: "2026-09-09T04:00:00.000Z",
      cwd: "/tmp/test-worktree",
    }),
  ].join("\n");

  writeFileSync(join(projectDir, "session-1.jsonl"), session1);
  writeFileSync(join(projectDir, "session-2.jsonl"), session2);

  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadClaudeCodeUsageNoDir(): void {
  const orig = process.env.FAPONY_CLAUDE_PROJECTS_DIR;
  try {
    process.env.FAPONY_CLAUDE_PROJECTS_DIR = "/nonexistent/claude/projects";
    const result = readClaudeCodeUsage();
    assert.equal(result.session_count, 0);
    assert.equal(result.total_tokens_input, 0);
    console.log("  ✓ readClaudeCodeUsage no dir → empty result");
  } finally {
    if (orig === undefined) delete process.env.FAPONY_CLAUDE_PROJECTS_DIR;
    else process.env.FAPONY_CLAUDE_PROJECTS_DIR = orig;
  }
}

export function testReadClaudeCodeUsagePrimaryPath(): void {
  withClaudeCodeFixture((dir) => {
    const orig = process.env.FAPONY_CLAUDE_PROJECTS_DIR;
    try {
      process.env.FAPONY_CLAUDE_PROJECTS_DIR = join(dir, "projects");
      const result = readClaudeCodeUsage("/tmp/test-worktree");
      assert.equal(
        result.session_count,
        2,
        `got ${result.session_count} sessions`,
      );
      assert.equal(result.total_tokens_input, 450); // 100 + 200 + 150
      assert.equal(result.total_tokens_output, 190); // 50 + 80 + 60
      assert.equal(result.total_tokens_reasoning, 40); // 15 + 25
      assert.equal(result.total_tokens_cache_read, 25); // 10 + 15
      assert.equal(result.total_tokens_cache_write, 50); // 20 + 30
      assert.equal(result.total_cost, 0, "Claude Code has no cost");
      assert.ok(result.by_model.length >= 1);
      const sonnet = result.by_model.find((m) => m.model === "claude-sonnet-5");
      assert.ok(sonnet, "claude-sonnet-5 found");
      assert.equal(sonnet!.tokens_input, 250); // 100 + 150
      console.log("  ✓ readClaudeCodeUsage primary path → reads JSONL files");
    } finally {
      if (orig === undefined) delete process.env.FAPONY_CLAUDE_PROJECTS_DIR;
      else process.env.FAPONY_CLAUDE_PROJECTS_DIR = orig;
    }
  });
}

export function testReadClaudeCodeUsageStaleReads(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-claude-code-stale-"));
  const projectDir = join(dir, "projects", "-tmp-test-worktree");
  const { mkdirSync } = require("node:fs");
  mkdirSync(projectDir, { recursive: true });

  const toolUseLine = (
    model: string,
    ts: string,
    tool: "Read" | "Edit",
    file: string,
  ) =>
    JSON.stringify({
      message: {
        model,
        content: [
          {
            type: "tool_use",
            id: `u-${ts}`,
            name: tool,
            input: { file_path: file },
          },
        ],
      },
      timestamp: ts,
      cwd: "/tmp/test-worktree",
    });
  const usageLine = (model: string, ts: string) =>
    JSON.stringify({
      message: { model, usage: { input_tokens: 10, output_tokens: 5 } },
      timestamp: ts,
      cwd: "/tmp/test-worktree",
    });

  // Session 1: reads CLAUDE.md (never edited anywhere).
  const session1 = [
    toolUseLine(
      "claude-sonnet-5",
      "2026-09-09T03:00:00.000Z",
      "Read",
      "/repo/CLAUDE.md",
    ),
    usageLine("claude-sonnet-5", "2026-09-09T03:00:01.000Z"),
  ].join("\n");
  // Session 2: reads CLAUDE.md again (2nd distinct session → stale) and
  // reads+edits scratch.ts in the same window (never stale).
  const session2 = [
    toolUseLine(
      "claude-sonnet-5",
      "2026-09-09T04:00:00.000Z",
      "Read",
      "/repo/CLAUDE.md",
    ),
    toolUseLine(
      "claude-sonnet-5",
      "2026-09-09T04:00:01.000Z",
      "Read",
      "/repo/scratch.ts",
    ),
    toolUseLine(
      "claude-sonnet-5",
      "2026-09-09T04:00:02.000Z",
      "Edit",
      "/repo/scratch.ts",
    ),
    usageLine("claude-sonnet-5", "2026-09-09T04:00:03.000Z"),
  ].join("\n");

  writeFileSync(join(projectDir, "session-1.jsonl"), session1);
  writeFileSync(join(projectDir, "session-2.jsonl"), session2);

  const orig = process.env.FAPONY_CLAUDE_PROJECTS_DIR;
  try {
    process.env.FAPONY_CLAUDE_PROJECTS_DIR = join(dir, "projects");
    const result = readClaudeCodeUsage(
      "/tmp/test-worktree",
      undefined,
      undefined,
      true,
    );
    assert.ok(result.detail, "detail:true must include detail");
    const stale = result.detail!.stale_reads ?? [];
    const claudeMd = stale.find((s) => s.file === "/repo/CLAUDE.md");
    assert.ok(claudeMd, "CLAUDE.md flagged as stale");
    assert.equal(claudeMd!.sessions, 2);
    assert.equal(claudeMd!.reads, 2);
    assert.ok(
      !stale.find((s) => s.file === "/repo/scratch.ts"),
      "edited file is never flagged as stale",
    );
    console.log(
      "  ✓ readClaudeCodeUsage detail → stale_reads flags multi-session reads that are never edited",
    );
  } finally {
    if (orig === undefined) delete process.env.FAPONY_CLAUDE_PROJECTS_DIR;
    else process.env.FAPONY_CLAUDE_PROJECTS_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadClaudeCodeUsageFilterByWorktree(): void {
  withClaudeCodeFixture((dir) => {
    const orig = process.env.FAPONY_CLAUDE_PROJECTS_DIR;
    try {
      process.env.FAPONY_CLAUDE_PROJECTS_DIR = join(dir, "projects");
      // Matching worktree → finds data
      const result = readClaudeCodeUsage("/tmp/test-worktree");
      assert.equal(result.session_count, 2);
      // Non-existent worktree → empty
      const empty = readClaudeCodeUsage("/nonexistent/wt");
      assert.equal(empty.session_count, 0);
      console.log("  ✓ readClaudeCodeUsage filter by worktree");
    } finally {
      if (orig === undefined) delete process.env.FAPONY_CLAUDE_PROJECTS_DIR;
      else process.env.FAPONY_CLAUDE_PROJECTS_DIR = orig;
    }
  });
}

export function testReadClaudeCodeUsageSkipsMalformedLines(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-claude-malformed-"));
  const projectDir = join(dir, "projects", "-tmp-test-worktree");
  const { mkdirSync } = require("node:fs");
  mkdirSync(projectDir, { recursive: true });

  const content = [
    "not valid json at all",
    JSON.stringify({
      message: {
        model: "claude-sonnet-5",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      timestamp: "2026-09-09T03:00:00.000Z",
      cwd: "/tmp/test-worktree",
    }),
    "{ broken json",
    JSON.stringify({ type: "queue-operation" }), // no message.usage
  ].join("\n");

  writeFileSync(join(projectDir, "session-1.jsonl"), content);

  const orig = process.env.FAPONY_CLAUDE_PROJECTS_DIR;
  try {
    process.env.FAPONY_CLAUDE_PROJECTS_DIR = join(dir, "projects");
    const result = readClaudeCodeUsage("/tmp/test-worktree");
    assert.equal(result.session_count, 1, "skips malformed lines");
    assert.equal(result.total_tokens_input, 100);
    console.log("  ✓ readClaudeCodeUsage skips malformed lines");
  } finally {
    if (orig === undefined) delete process.env.FAPONY_CLAUDE_PROJECTS_DIR;
    else process.env.FAPONY_CLAUDE_PROJECTS_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- codex usage tests ---

function withCodexFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-codex-"));
  const sessionsDir = join(dir, "2026", "09", "09");
  const { mkdirSync } = require("node:fs");
  mkdirSync(sessionsDir, { recursive: true });

  // Session 1: 2 token_usage_record lines, 1 model
  const session1 = [
    JSON.stringify({
      timestamp: "2026-09-09T10:59:01.413Z",
      ordinal: 0,
      type: "session_meta",
      payload: {
        session_id: "01a085d2-34b5-7b03-946a-8e8de8a5d775",
        cwd: "/tmp/test-worktree",
        timestamp: "2026-09-09T10:59:00.948Z",
        model_provider: "openai",
        model: "gpt-5.6-terra",
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T10:59:09.677Z",
      ordinal: 1,
      type: "token_usage_record",
      payload: {
        session_id: "01a085d2-34b5-7b03-946a-8e8de8a5d775",
        usage: {
          input_tokens: 29949,
          output_tokens: 186,
          reasoning_output_tokens: 79,
          cached_input_tokens: 16128,
          cache_write_input_tokens: 0,
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T10:59:13.421Z",
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        session_id: "01a085d2-34b5-7b03-946a-8e8de8a5d775",
        usage: {
          input_tokens: 32267,
          output_tokens: 84,
          reasoning_output_tokens: 0,
          cached_input_tokens: 29440,
          cache_write_input_tokens: 0,
        },
      },
    }),
    // Two tool calls, deliberately different output sizes, for the detail
    // pass (tool_breakdown + bytes_by_tool matched by call_id).
    JSON.stringify({
      timestamp: "2026-09-09T10:59:14.000Z",
      ordinal: 3,
      type: "response_item",
      payload: { type: "custom_tool_call", call_id: "call_1", name: "exec" },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T10:59:14.100Z",
      ordinal: 4,
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call_1",
        output: [{ type: "input_text", text: "short" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T10:59:15.000Z",
      ordinal: 5,
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "call_2",
        name: "apply_patch",
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T10:59:15.100Z",
      ordinal: 6,
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call_2",
        output: [{ type: "input_text", text: "a".repeat(200) }],
      },
    }),
  ].join("\n");

  // Session 2: 1 token_usage_record line
  const session2 = [
    JSON.stringify({
      timestamp: "2026-09-09T11:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: {
        session_id: "02b196e3-45c6-8c14-a57b-9f9ef9b6e886",
        cwd: "/tmp/test-worktree",
        timestamp: "2026-09-09T11:00:00.000Z",
        model_provider: "openai",
        model: "gpt-5.6-terra",
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T11:00:05.000Z",
      ordinal: 1,
      type: "token_usage_record",
      payload: {
        session_id: "02b196e3-45c6-8c14-a57b-9f9ef9b6e886",
        usage: {
          input_tokens: 15000,
          output_tokens: 500,
          reasoning_output_tokens: 100,
          cached_input_tokens: 5000,
          cache_write_input_tokens: 200,
        },
      },
    }),
  ].join("\n");

  writeFileSync(
    join(sessionsDir, "rollout-2026-09-09T10-59-00-01a085d2.jsonl"),
    session1,
  );
  writeFileSync(
    join(sessionsDir, "rollout-2026-09-09T11-00-00-02b196e3.jsonl"),
    session2,
  );

  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadCodexUsageNoDir(): void {
  const orig = process.env.FAPONY_CODEX_SESSIONS_DIR;
  try {
    process.env.FAPONY_CODEX_SESSIONS_DIR = "/nonexistent/codex/sessions";
    const result = readCodexUsage();
    assert.equal(result.session_count, 0);
    assert.equal(result.total_tokens_input, 0);
    console.log("  ✓ readCodexUsage no dir → empty result");
  } finally {
    if (orig === undefined) delete process.env.FAPONY_CODEX_SESSIONS_DIR;
    else process.env.FAPONY_CODEX_SESSIONS_DIR = orig;
  }
}

export function testReadCodexUsagePrimaryPath(): void {
  withCodexFixture((dir) => {
    const orig = process.env.FAPONY_CODEX_SESSIONS_DIR;
    try {
      process.env.FAPONY_CODEX_SESSIONS_DIR = dir;
      const result = readCodexUsage("/tmp/test-worktree");
      assert.equal(
        result.session_count,
        2,
        `got ${result.session_count} sessions`,
      );
      assert.equal(result.total_tokens_input, 77216); // 29949 + 32267 + 15000
      assert.equal(result.total_tokens_output, 770); // 186 + 84 + 500
      assert.equal(result.total_tokens_reasoning, 179); // 79 + 0 + 100
      assert.equal(result.total_tokens_cache_read, 50568); // 16128 + 29440 + 5000
      assert.equal(result.total_tokens_cache_write, 200); // 0 + 0 + 200
      assert.equal(result.total_cost, 0, "Codex has no cost");
      assert.ok(result.by_model.length >= 1);
      const terra = result.by_model.find((m) => m.model === "gpt-5.6-terra");
      assert.ok(terra, "gpt-5.6-terra found");
      assert.equal(terra!.tokens_input, 77216);
      console.log("  ✓ readCodexUsage primary path → reads JSONL files");
    } finally {
      if (orig === undefined) delete process.env.FAPONY_CODEX_SESSIONS_DIR;
      else process.env.FAPONY_CODEX_SESSIONS_DIR = orig;
    }
  });
}

export function testReadCodexUsageDetailBytesByTool(): void {
  withCodexFixture((dir) => {
    const orig = process.env.FAPONY_CODEX_SESSIONS_DIR;
    try {
      process.env.FAPONY_CODEX_SESSIONS_DIR = dir;
      const result = readCodexUsage(
        "/tmp/test-worktree",
        undefined,
        undefined,
        true,
      );
      assert.ok(result.detail, "detail:true must include detail");
      assert.deepEqual(result.detail!.tool_breakdown, {
        exec: 1,
        apply_patch: 1,
      });
      const bbt = result.detail!.bytes_by_tool!;
      assert.ok(bbt, "bytes_by_tool present");
      // apply_patch's fixture output is ~40x longer than exec's — the
      // proportion, not the exact byte count, is what matters.
      assert.ok(
        bbt.apply_patch > bbt.exec * 5,
        `expected apply_patch >> exec, got ${JSON.stringify(bbt)}`,
      );
      console.log(
        "  ✓ readCodexUsage detail → tool_breakdown + bytes_by_tool from custom_tool_call pairs",
      );
    } finally {
      if (orig === undefined) delete process.env.FAPONY_CODEX_SESSIONS_DIR;
      else process.env.FAPONY_CODEX_SESSIONS_DIR = orig;
    }
  });
}

export function testReadCodexUsageFilterByWorktree(): void {
  withCodexFixture((dir) => {
    const orig = process.env.FAPONY_CODEX_SESSIONS_DIR;
    try {
      process.env.FAPONY_CODEX_SESSIONS_DIR = dir;
      // Matching worktree → finds data
      const result = readCodexUsage("/tmp/test-worktree");
      assert.equal(result.session_count, 2);
      // Non-existent worktree → empty
      const empty = readCodexUsage("/nonexistent/wt");
      assert.equal(empty.session_count, 0);
      console.log("  ✓ readCodexUsage filter by worktree");
    } finally {
      if (orig === undefined) delete process.env.FAPONY_CODEX_SESSIONS_DIR;
      else process.env.FAPONY_CODEX_SESSIONS_DIR = orig;
    }
  });
}

export function testReadCodexUsageSkipsMalformedLines(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-codex-malformed-"));
  const sessionsDir = join(dir, "2026", "09", "09");
  const { mkdirSync } = require("node:fs");
  mkdirSync(sessionsDir, { recursive: true });

  const content = [
    "not valid json at all",
    JSON.stringify({
      timestamp: "2026-09-09T10:59:01.413Z",
      type: "session_meta",
      payload: {
        session_id: "test-session",
        cwd: "/tmp/test-worktree",
        model: "gpt-5.6-terra",
      },
    }),
    "{ broken json",
    JSON.stringify({
      timestamp: "2026-09-09T10:59:09.677Z",
      type: "token_usage_record",
      payload: {
        session_id: "test-session",
        usage: {
          input_tokens: 1000,
          output_tokens: 50,
          reasoning_output_tokens: 10,
          cached_input_tokens: 200,
          cache_write_input_tokens: 0,
        },
      },
    }),
    JSON.stringify({ type: "some_other_event" }), // not token_usage_record
  ].join("\n");

  writeFileSync(join(sessionsDir, "rollout-test.jsonl"), content);

  const orig = process.env.FAPONY_CODEX_SESSIONS_DIR;
  try {
    process.env.FAPONY_CODEX_SESSIONS_DIR = dir;
    const result = readCodexUsage("/tmp/test-worktree");
    assert.equal(result.session_count, 1, "skips malformed lines");
    assert.equal(result.total_tokens_input, 1000);
    assert.equal(result.total_tokens_output, 50);
    console.log("  ✓ readCodexUsage skips malformed lines");
  } finally {
    if (orig === undefined) delete process.env.FAPONY_CODEX_SESSIONS_DIR;
    else process.env.FAPONY_CODEX_SESSIONS_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testMergeBytesByToolSumsAcrossClients(): void {
  const a = {
    tool_breakdown: {},
    steps: 0,
    by_session: [],
    note: "",
    bytes_by_tool: { Read: 10 },
  };
  const b = {
    tool_breakdown: {},
    steps: 0,
    by_session: [],
    note: "",
    bytes_by_tool: { Read: 5, Grep: 3 },
  };
  assert.deepStrictEqual(mergeBytesByTool(a, b, null, undefined), {
    Read: 15,
    Grep: 3,
  });
  assert.deepStrictEqual(mergeBytesByTool(null, undefined), {});
  console.log("  ✓ mergeBytesByTool sums per-tool bytes across clients");
}

// ─── Read failures are named, not silent (agent-me's KnowledgeLoadError idea) ──

export function testSessionReadFailureReportsErrorCode(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-baddb-"));
  const dbPath = join(dir, "opencode.db");
  // A file that exists but is not a SQLite DB — the same shape a schema change
  // produces: the read throws, and the old catch-all turned that into zeros
  // indistinguishable from "no sessions".
  writeFileSync(dbPath, "not a sqlite database at all");
  const orig = process.env.FAPONY_OPENCODE_DB;
  try {
    process.env.FAPONY_OPENCODE_DB = dbPath;
    const r = readPassiveUsage();
    assert.equal(r.session_count, 0);
    assert.equal(r.error, "opencode_read_failed", "failed read carries a code");

    // A DB that is simply absent is NOT an error — it means "client not used".
    process.env.FAPONY_OPENCODE_DB = join(dir, "missing.db");
    assert.equal(
      readPassiveUsage().error,
      undefined,
      "absent DB is not an error",
    );
    console.log(
      "  ✓ session read failure reports an error code, absent DB does not",
    );
  } finally {
    if (orig === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testBeginSnapshotOnlyUnderWal(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-snap-"));
  try {
    for (const [mode, expected] of [
      ["WAL", true],
      ["DELETE", false],
    ] as Array<[string, boolean]>) {
      const p = join(dir, `${mode}.db`);
      const seed = new Database(p);
      seed.run(`PRAGMA journal_mode = ${mode}`);
      seed.run("CREATE TABLE t (x INTEGER)");
      seed.close();

      const db = new Database(p, { readonly: true });
      try {
        const open = beginSnapshot(db);
        assert.equal(open, expected, `${mode}: snapshot opened == ${expected}`);
        // Whatever was decided, the DB stays usable and endSnapshot is safe.
        assert.deepStrictEqual(db.prepare("SELECT 1 AS n").get(), { n: 1 });
        endSnapshot(db, open);
        endSnapshot(db, false); // no-op, must not throw
      } finally {
        db.close();
      }
    }
    console.log("  ✓ beginSnapshot pins a read snapshot under WAL only");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
