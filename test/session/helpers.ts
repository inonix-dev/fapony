// test/session/helpers.ts — shared fixtures for session usage tests.
//
// Each client (opencode, zcode, claude-code, codex) needs a temporary DB or
// JSONL directory seeded with realistic data. These helpers create, seed, and
// clean up so each test file stays focused on assertions.

import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── env restore helper ──

export function withEnv(key: string, value: string, fn: () => void): void {
  const prev = process.env[key];
  process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// ── OpenCode fixtures ──

export function withFixtureDb(fn: (dbPath: string) => void): void {
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
    sess.run("s1", "p1", "/tmp/wt1/wt-sub", "m1", 1000, 100, 50, 0.01);
    sess.run("s2", "p1", "/tmp/wt1", "m1", 2000, 200, 60, 0.02);

    const part = db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, 1, 1, ?)`,
    );
    const tool = (t: string, extra = {}) =>
      JSON.stringify({ type: "tool", tool: t, ...extra });
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

// ── ZCode fixtures ──

export function withZcodeFixtureDb(fn: (dbPath: string) => void): void {
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

// ── Claude Code fixtures ──

export function withClaudeCodeFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-claude-code-"));
  const projectDir = join(dir, "projects", "-tmp-test-worktree");
  mkdirSync(projectDir, { recursive: true });

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

// ── Codex fixtures ──

export function withCodexFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-codex-"));
  const sessionsDir = join(dir, "2026", "09", "09");
  mkdirSync(sessionsDir, { recursive: true });

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
