import { test } from "bun:test";
// test/findModel.test.ts — tests for findSessionModel (session log model resolution)

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSessionModel } from "../src/session/findModel.js";

// --- OpenCode fixture ---

function withOpenCodeFixture(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-opencode-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    db.run(
      `CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT,
        time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0,
        tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0
      )`,
    );
    db.run(
      `CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      )`,
    );
    // Plain-text model
    db.prepare(
      `INSERT INTO session (id, project_id, model, time_created) VALUES (?, ?, ?, ?)`,
    ).run(
      "sess-plain",
      "p1",
      '{"providerID":"anthropic","id":"claude-sonnet-5"}',
      1000,
    );
    db.prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`).run(
      "p1",
      "/tmp/wt1",
    );
    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("testFindSessionModelOpenCodeHit", () => {
  withOpenCodeFixture((dbPath) => {
    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const result = findSessionModel("sess-plain");
      assert.ok(result, "should find session");
      assert.equal(result!.model, "claude-sonnet-5");
      assert.equal(result!.provider, "anthropic");
      assert.equal(result!.client, "opencode");
      assert.equal(result!.agent, null);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel OpenCode hit");
});

test("testFindSessionModelOpenCodeMiss", () => {
  withOpenCodeFixture((dbPath) => {
    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const result = findSessionModel("nonexistent");
      assert.equal(result, null);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel OpenCode miss → null");
});

// --- ZCode fixture ---

function withZcodeFixture(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-zcode-"));
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
        provider_id TEXT, agent TEXT,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0, cache_creation_input_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0, computed_total_tokens INTEGER DEFAULT 0
      )`,
    );
    db.prepare(
      `INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`,
    ).run("z1", "p1", "/tmp/zwt", 1700000000, 1700000100);
    db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, provider_id, agent, input_tokens, output_tokens, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "mu1",
      "z1",
      "claude-opus-5",
      "anthropic",
      "zcode-Explore",
      1000,
      500,
      1500,
    );
    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("testFindSessionModelZcodeHit", () => {
  withZcodeFixture((dbPath) => {
    const prev = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = findSessionModel("z1");
      assert.ok(result, "should find session");
      assert.equal(result!.model, "claude-opus-5");
      assert.equal(result!.provider, "anthropic");
      assert.equal(result!.client, "zcode");
      assert.equal(result!.agent, "zcode-Explore");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel ZCode hit");
});

test("testFindSessionModelZcodeMiss", () => {
  withZcodeFixture((dbPath) => {
    const prev = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = findSessionModel("nonexistent");
      assert.equal(result, null);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel ZCode miss → null");
});

test("testFindSessionModelZcodeRawProviderPassthrough", () => {
  // provider_id is sometimes a raw UUID — pass through as-is, never map it
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-zcode-uuid-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        provider_id TEXT, agent TEXT,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0,
        cache_creation_input_tokens INTEGER DEFAULT 0,
        computed_total_tokens INTEGER NOT NULL DEFAULT 0
      )`,
    );
    db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, provider_id, agent, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "m1",
      "zu",
      "some-model",
      "ce20a13d-8549-4e5a-823a-0b1359247b17",
      null,
      10,
    );
    const prev = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = findSessionModel("zu");
      assert.ok(result, "should find session");
      assert.equal(result!.provider, "ce20a13d-8549-4e5a-823a-0b1359247b17");
      assert.equal(result!.agent, null);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prev;
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel ZCode raw provider passes through");
});

test("testFindSessionModelOpenCodePlainTextProviderUnknown", () => {
  // Plain-text session.model carries no provider — "—", never ""
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-opencode-plain-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0)`,
    );
    db.prepare(
      `INSERT INTO session (id, project_id, model) VALUES (?, ?, ?)`,
    ).run("sp", "p1", "some-plain-model");
    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const result = findSessionModel("sp");
      assert.ok(result, "should find session");
      assert.equal(result!.model, "some-plain-model");
      assert.equal(result!.provider, "—");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel OpenCode plain-text provider → —");
});

test("testFindSessionModelZcodeMultiModel", () => {
  // 3 small rows of model-a vs 1 big row of model-b → max tokens wins
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-zcode-multi-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        provider_id TEXT, agent TEXT,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0,
        cache_creation_input_tokens INTEGER DEFAULT 0,
        computed_total_tokens INTEGER NOT NULL DEFAULT 0
      )`,
    );
    const ins = db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, provider_id, agent, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    ins.run("m1", "zm", "model-a", "prov-a", "zcode-agent", 100);
    ins.run("m2", "zm", "model-a", "prov-a", "zcode-agent", 200);
    ins.run("m3", "zm", "model-a", "prov-a", "zcode-agent", 150);
    ins.run("m4", "zm", "model-b", "prov-b", "zcode-general-purpose", 5000);
    const prev = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = findSessionModel("zm");
      assert.ok(result, "should find session");
      assert.equal(result!.model, "model-b");
      // Same dominant row picks provider + agent too
      assert.equal(result!.provider, "prov-b");
      assert.equal(result!.agent, "zcode-general-purpose");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prev;
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel ZCode multi-model → max tokens");
});

test("testFindSessionModelZcodeSummedTokensWin", () => {
  // Model A: 3 small rows summing past B's single big row → A wins.
  // A lone max-row rule (no GROUP BY) would wrongly pick B.
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-zcode-sum-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        provider_id TEXT, agent TEXT,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0,
        cache_creation_input_tokens INTEGER DEFAULT 0,
        computed_total_tokens INTEGER NOT NULL DEFAULT 0
      )`,
    );
    const ins = db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, provider_id, agent, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    ins.run("m1", "zs", "model-a", "prov-a", "zcode-agent", 2000);
    ins.run("m2", "zs", "model-a", "prov-a", "zcode-agent", 2000);
    ins.run("m3", "zs", "model-a", "prov-a", "zcode-agent", 2000);
    ins.run("m4", "zs", "model-b", "prov-b", "zcode-agent", 5000);
    const prev = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = findSessionModel("zs");
      assert.ok(result, "should find session");
      assert.equal(result!.model, "model-a", "summed 6000 beats lone 5000");
      assert.equal(result!.provider, "prov-a");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prev;
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel ZCode summed tokens beat lone max row");
});

// --- Claude Code fixture ---

function withClaudeCodeFixture(fn: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-claude-"));
  const filePath = join(dir, "session-1.jsonl");
  const content = [
    JSON.stringify({
      message: {
        model: "claude-sonnet-5",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      timestamp: "2026-09-09T03:00:00.000Z",
    }),
  ].join("\n");
  writeFileSync(filePath, content);
  try {
    fn(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("testFindSessionModelClaudeCodeHit", () => {
  withClaudeCodeFixture((filePath) => {
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "claude-sonnet-5");
    assert.equal(result!.provider, "anthropic");
    assert.equal(result!.client, "claude-code");
    assert.equal(result!.agent, null);
  });
  console.log("  ✓ findSessionModel Claude Code hit");
});

test("testFindSessionModelClaudeCodeMiss", () => {
  const result = findSessionModel("/nonexistent/path/session.jsonl");
  assert.equal(result, null);
  console.log("  ✓ findSessionModel Claude Code miss → null");
});

function writeClaudeLines(dir: string, name: string, models: string[]): string {
  const filePath = join(dir, name);
  const content = models
    .map((m, i) =>
      JSON.stringify({
        message: {
          model: m,
          usage: { input_tokens: 100 + i, output_tokens: 50 },
        },
        timestamp: `2026-09-09T03:${String(i).padStart(2, "0")}:00.000Z`,
      }),
    )
    .join("\n");
  writeFileSync(filePath, content);
  return filePath;
}

test("testFindSessionModelClaudeCodeMajority", () => {
  // Opus diagnose (first, 2 turns) → Sonnet implements (5 turns): majority wins
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-claude-multi-"));
  try {
    const filePath = writeClaudeLines(dir, "session-multi.jsonl", [
      "claude-opus-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-sonnet-5",
      "claude-sonnet-5",
      "claude-sonnet-5",
      "claude-sonnet-5",
    ]);
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "claude-sonnet-5");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel Claude Code multi-model → majority");
});

test("testFindSessionModelClaudeCodeTieGoesLast", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-claude-tie-"));
  try {
    const filePath = writeClaudeLines(dir, "session-tie.jsonl", [
      "claude-opus-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-sonnet-5",
    ]);
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "claude-sonnet-5", "tie → last seen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel Claude Code tie → last");
});

// --- Codex fixture ---

function withCodexFixture(fn: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-codex-"));
  const filePath = join(dir, "rollout.jsonl");
  const content = [
    JSON.stringify({
      timestamp: "2026-09-09T10:59:01.413Z",
      type: "session_meta",
      payload: {
        session_id: "abc-123",
        cwd: "/tmp/test",
        model_provider: "openai",
        model: "gpt-5.6-terra",
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T10:59:09.677Z",
      type: "token_usage_record",
      payload: {
        session_id: "abc-123",
        usage: { input_tokens: 1000, output_tokens: 50 },
      },
    }),
  ].join("\n");
  writeFileSync(filePath, content);
  try {
    fn(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("testFindSessionModelCodexHit", () => {
  withCodexFixture((filePath) => {
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "gpt-5.6-terra");
    assert.equal(result!.provider, "openai");
    assert.equal(result!.client, "codex");
    assert.equal(result!.agent, null);
  });
  console.log("  ✓ findSessionModel Codex hit");
});

test("testFindSessionModelCodexMiss", () => {
  const result = findSessionModel("/nonexistent/path/rollout.jsonl");
  assert.equal(result, null);
  console.log("  ✓ findSessionModel Codex miss → null");
});

function writeCodexMetas(dir: string, name: string, models: string[]): string {
  const filePath = join(dir, name);
  const content = models
    .map((m, i) =>
      JSON.stringify({
        timestamp: `2026-09-09T10:59:0${i}.000Z`,
        type: "session_meta",
        payload: {
          session_id: "multi",
          cwd: "/tmp/test",
          model_provider: "openai",
          model: m,
        },
      }),
    )
    .join("\n");
  writeFileSync(filePath, content);
  return filePath;
}

test("testFindSessionModelCodexMultiMeta", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-codex-multi-"));
  try {
    const filePath = writeCodexMetas(dir, "rollout-multi.jsonl", [
      "gpt-a",
      "gpt-b",
      "gpt-b",
    ]);
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "gpt-b", "majority of session_meta wins");
    assert.equal(result!.provider, "openai");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel Codex multi session_meta → majority");
});

test("testFindSessionModelCodexMultiMetaTieGoesLast", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-codex-tie-"));
  try {
    const filePath = writeCodexMetas(dir, "rollout-tie.jsonl", [
      "gpt-a",
      "gpt-b",
    ]);
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "gpt-b", "tie → last seen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ findSessionModel Codex multi session_meta tie → last");
});

// --- Edge cases ---

test("testFindSessionModelEmptyId", () => {
  const result = findSessionModel("");
  assert.equal(result, null);
  console.log("  ✓ findSessionModel empty string → null");
});

test("testFindSessionModelNoReadersAvailable", () => {
  // Point all DBs to nonexistent paths — should return null, not throw
  const prevOC = process.env.FAPONY_OPENCODE_DB;
  const prevZC = process.env.FAPONY_ZCODE_DB;
  try {
    process.env.FAPONY_OPENCODE_DB = "/nonexistent/oc.db";
    process.env.FAPONY_ZCODE_DB = "/nonexistent/zc.db";
    const result = findSessionModel("any-id");
    assert.equal(result, null);
  } finally {
    if (prevOC === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prevOC;
    if (prevZC === undefined) delete process.env.FAPONY_ZCODE_DB;
    else process.env.FAPONY_ZCODE_DB = prevZC;
  }
  console.log("  ✓ findSessionModel no readers → null");
});
