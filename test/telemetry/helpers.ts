// test/telemetry/helpers.ts — shared helpers for telemetry tests

export { withTempConfig, withTmpDb } from "../helpers.js";

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addEvent,
  newRun,
  type openDb,
  setStatus,
} from "../../src/db/store.js";

export function createEmptyOpencodeDb(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "fapony-telemetry-opencode-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  db.run(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`);
  db.run(
    `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL DEFAULT '', model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
  );
  db.run(
    `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
  );
  db.close();
  return { dir, dbPath };
}

export function withEmptyOpencodeDb(fn: () => void): void {
  const { dir, dbPath } = createEmptyOpencodeDb();
  const prevDb = process.env.FAPONY_OPENCODE_DB;
  process.env.FAPONY_OPENCODE_DB = dbPath;
  try {
    fn();
  } finally {
    if (prevDb === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prevDb;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function setRunWindow(
  db: ReturnType<typeof openDb>,
  runId: number,
  created: string,
  updated: string,
): void {
  // AFTER setStatus — setStatus overwrites updated_at with datetime('now').
  db.prepare(`UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?`).run(
    created,
    updated,
    runId,
  );
}

export function makeRun(
  db: ReturnType<typeof openDb>,
  worktree: string,
  model: string,
  verdict: string,
  created: string,
  updated: string,
): number {
  const run = newRun(db, worktree, null, null, "abc");
  addEvent(db, run, "spawn", { role: "executor", model });
  addEvent(db, run, "gate", { verdict, note: "", round: 0 });
  setStatus(db, run, "passed");
  setRunWindow(db, run, created, updated);
  return run;
}
