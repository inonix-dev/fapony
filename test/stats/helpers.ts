// test/stats/helpers.ts — shared helpers for stats tests.
//
// Re-exports the generic helpers from test/helpers.ts and adds what only stats
// tests need: OpenCode / ZCode DB builders (eliminating 5× copy-paste) and
// env wrappers (eliminating 5× try/finally).

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export { withTmpDb } from "../helpers.js";

/** Create an OpenCode DB with the schema stats queries expect. */
export function makeOpenCodeDb(dir: string): {
  dbPath: string;
  close: () => void;
} {
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  db.run(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`);
  db.run(
    `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
  );
  db.run(
    `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
  );
  db.close();
  return {
    dbPath,
    close: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* already cleaned */
      }
    },
  };
}

/** Create a ZCode DB with the schema stats queries expect. */
export function makeZCodeDb(dir: string): {
  dbPath: string;
  close: () => void;
} {
  const dbPath = join(dir, "zcode.sqlite");
  const db = new Database(dbPath);
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
  db.close();
  return {
    dbPath,
    close: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* already cleaned */
      }
    },
  };
}

/** Set FAPONY_OPENCODE_DB for the duration of fn, then restore. */
export function withOpenCodeEnv(dbPath: string, fn: () => void): void {
  const prev = process.env.FAPONY_OPENCODE_DB;
  try {
    process.env.FAPONY_OPENCODE_DB = dbPath;
    fn();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prev;
  }
}

/** Set FAPONY_ZCODE_DB for the duration of fn, then restore. */
export function withZCodeEnv(dbPath: string, fn: () => void): void {
  const prev = process.env.FAPONY_ZCODE_DB;
  try {
    process.env.FAPONY_ZCODE_DB = dbPath;
    fn();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
    else process.env.FAPONY_ZCODE_DB = prev;
  }
}

/**
 * OpenCode fixture: one session with tokens, reusable by the cost/pass tests.
 * Creates a temp dir, builds the DB, sets the env, runs fn, then cleans up.
 */
export function withOpenCodeSession(
  sessionId: string,
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  },
  fn: () => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-stats-perpass-"));
  const { dbPath, close } = makeOpenCodeDb(dir);
  const db = new Database(dbPath);
  db.run(`INSERT INTO project (id, worktree) VALUES (?, ?)`, "p1", "/tmp/wt1");
  db.prepare(
    `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    "p1",
    '{"providerID":"anthropic","id":"claude-sonnet-5"}',
    1000,
    tokens.input,
    tokens.output,
    tokens.cacheRead,
    tokens.cacheWrite,
  );
  db.close();
  withOpenCodeEnv(dbPath, () => {
    try {
      fn();
    } finally {
      close();
    }
  });
}
