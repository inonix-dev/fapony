import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addEvent,
  getRun,
  migrateDb,
  newRun,
  openDb,
  SCHEMA_VERSION,
  setStatus,
} from "../src/db/store.js";
import { withTmpDb } from "./helpers.js";

export function testDbLifecycle(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");

    let run = getRun(db, runId);
    assert(run !== null, "run should exist");
    assert.equal(run?.status, "running");
    assert.equal(run?.round, 0);
    assert.equal(run?.worktree, "test-wt");
    assert.equal(run?.base_sha, "abc123");

    setStatus(db, runId, "awaiting_review");
    run = getRun(db, runId);
    assert.equal(run?.status, "awaiting_review");

    addEvent(db, runId, "commit", { hash: "def456" });
    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ?")
      .all(runId) as { kind: string; data: string }[];
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "commit");
    assert.deepEqual(JSON.parse(events[0].data), { hash: "def456" });

    setStatus(db, runId, "passed");
    run = getRun(db, runId);
    assert.equal(run?.status, "passed");
  });

  console.log("  ✓ db lifecycle");
}

function userVersion(db: ReturnType<typeof openDb>): number {
  const row = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  return row.user_version;
}

export function testSchemaVersionStamped(): void {
  withTmpDb((db) => {
    assert.equal(userVersion(db), SCHEMA_VERSION);
  });

  console.log("  ✓ schema version stamped on fresh db");
}

export function testLegacyDbStampedWithoutDataLoss(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    // Simulate a pre-versioning db: v1 tables, user_version 0.
    const legacy = new Database(`${dir}/state.db`);
    legacy.exec(
      `CREATE TABLE runs(id INTEGER PRIMARY KEY, worktree TEXT NOT NULL, plan TEXT, mem_id TEXT, status TEXT NOT NULL, base_sha TEXT NOT NULL DEFAULT '', round INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    legacy.exec(
      `CREATE TABLE events(id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, ts TEXT NOT NULL DEFAULT (datetime('now')), kind TEXT NOT NULL, data TEXT)`,
    );
    legacy.exec(
      `INSERT INTO runs (worktree, plan, mem_id, status, base_sha, round) VALUES ('old-wt', 'plan.md', NULL, 'passed', 'abc', 0)`,
    );
    legacy.close();

    const db = openDb();
    assert.equal(userVersion(db), SCHEMA_VERSION);
    const run = getRun(db, 1);
    assert(run !== null, "legacy row must survive migration");
    assert.equal(run?.worktree, "old-wt");
    db.close();

    // Reopen is idempotent — version stays, data stays.
    const db2 = openDb();
    assert.equal(userVersion(db2), SCHEMA_VERSION);
    assert.equal(getRun(db2, 1)?.worktree, "old-wt");
    db2.close();
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ legacy db stamped without data loss");
}

export function testMigrateDbRejectsNewerSchema(): void {
  withTmpDb((db) => {
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    assert.throws(() => migrateDb(db), /newer than supported/);
  });

  console.log("  ✓ migrateDb rejects newer schema");
}
