import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { faponyDir } from "./load.js";
import type { Config, Event, Run, RunStatus } from "./types.js";

/**
 * Schema version for state.db — tracked via `PRAGMA user_version`.
 *
 * v1 = the original runs/events tables (no version stamp; legacy DBs that
 * already have tables but user_version 0 are treated as v1).
 *
 * To change the schema: bump SCHEMA_VERSION and append the ALTER/CREATE
 * statements as a new entry in MIGRATIONS (index = version - 1). openDb()
 * applies every entry newer than the stored version, in order.
 */
export const SCHEMA_VERSION = 1;

const MIGRATIONS: string[][] = [
  // v1 — base schema
  [
    `CREATE TABLE IF NOT EXISTS runs(
      id INTEGER PRIMARY KEY,
      worktree TEXT NOT NULL,
      plan TEXT,
      mem_id TEXT,
      status TEXT NOT NULL,
      base_sha TEXT NOT NULL DEFAULT '',
      round INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL,
      data TEXT
    )`,
  ],
];

function getUserVersion(db: Database): number {
  const row = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  return row.user_version ?? 0;
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as {
    name: string;
  } | null;
  return row !== null;
}

/** Apply pending migrations; exported for tests. */
export function migrateDb(db: Database): void {
  const current = getUserVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `state.db schema version ${current} is newer than supported ${SCHEMA_VERSION} — upgrade fapony first`,
    );
  }
  if (current === SCHEMA_VERSION) return;
  if (current === 0 && tableExists(db, "runs")) {
    // Legacy DB from before versioning — schema matches v1, just stamp it.
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    for (const stmt of MIGRATIONS[v] ?? []) db.run(stmt);
    db.run(`PRAGMA user_version = ${v + 1}`);
  }
}

export function openDb(config?: Config): Database {
  const dir = faponyDir(config);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(`${dir}/state.db`);
  // bun default busy_timeout=0 = no retry on SQLITE_BUSY; multiple agent
  // processes share this db, so concurrent writers throw immediately without this.
  db.run("PRAGMA busy_timeout=5000");
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA synchronous=NORMAL");

  migrateDb(db);

  return db;
}

export function newRun(
  db: Database,
  worktree: string,
  plan: string | null,
  memId: string | null,
  baseSha: string,
): number {
  const stmt = db.prepare(
    `INSERT INTO runs (worktree, plan, mem_id, status, base_sha, round)
     VALUES (?, ?, ?, 'running', ?, 0)`,
  );
  const result = stmt.run(worktree, plan, memId, baseSha);
  return Number(result.lastInsertRowid);
}

export function setStatus(
  db: Database,
  runId: number,
  status: RunStatus,
): void {
  db.prepare(
    `UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, runId);
}

export function incrementRound(db: Database, runId: number): void {
  db.prepare(
    `UPDATE runs SET round = round + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(runId);
}

export function addEvent(
  db: Database,
  runId: number,
  kind: string,
  data: unknown,
): number {
  const stmt = db.prepare(
    `INSERT INTO events (run_id, kind, data) VALUES (?, ?, ?)`,
  );
  const result = stmt.run(runId, kind, JSON.stringify(data));
  return Number(result.lastInsertRowid);
}

/**
 * Merge `patch` into an existing event's JSON data (keeps keys already set).
 * Used to complete a spawn row with bytes_out/usd after the agent finishes —
 * one row per spawn, timing (ts) stays at spawn start. No-op when the row
 * is missing or its data isn't a JSON object.
 */
export function updateEventData(
  db: Database,
  eventId: number,
  patch: Record<string, unknown>,
): void {
  const row = db
    .prepare("SELECT data FROM events WHERE id = ?")
    .get(eventId) as { data: string | null } | null;
  if (!row) return;
  let base: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.data ?? "null") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      base = parsed as Record<string, unknown>;
    }
  } catch {
    return;
  }
  db.prepare("UPDATE events SET data = ? WHERE id = ?").run(
    JSON.stringify({ ...base, ...patch }),
    eventId,
  );
}

export function getRun(db: Database, runId: number): Run | null {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Run | null;
}

export function getActiveRuns(db: Database): Run[] {
  return db
    .prepare(
      "SELECT * FROM runs WHERE status NOT IN ('passed', 'stopped') ORDER BY id",
    )
    .all() as Run[];
}

/**
 * Latest still-open run for a worktree+plan pair, or null.
 * Used by MCP verdict_submit to bind a round-2+ verdict to the original run
 * instead of opening one row per review (which kept every run at round 0 and
 * made review.maxRounds untriggerable). No time window: a passed verdict
 * already closes the run to terminal, so any open match is a failed-not-yet-
 * fixed piece of work that the new verdict belongs to. plan=null never
 * matches — bare-diff reviews always open a fresh run.
 */
export function findOpenRun(
  db: Database,
  worktree: string,
  plan: string,
): Run | null {
  return db
    .prepare(
      `SELECT * FROM runs WHERE worktree = ? AND plan = ? AND status NOT IN ('passed', 'stopped', 'stalled') ORDER BY id DESC LIMIT 1`,
    )
    .get(worktree, plan) as Run | null;
}

/**
 * Latest still-open run with plan=null for a worktree, or null.
 * Used by MCP verdict_submit as a fallback when no exact plan match is found —
 * lets a verdict with free-text intent bind to a run that was created without
 * a plan (the common "no PLAN file" flow).
 */
export function findOpenRunWithNullPlan(
  db: Database,
  worktree: string,
): Run | null {
  return db
    .prepare(
      `SELECT * FROM runs WHERE worktree = ? AND plan IS NULL AND status NOT IN ('passed', 'stopped', 'stalled') ORDER BY id DESC LIMIT 1`,
    )
    .get(worktree) as Run | null;
}

export function getEvents(db: Database, runId: number): Event[] {
  return db
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY id")
    .all(runId) as Event[];
}

/**
 * Pulls the most recent unresolved "gate fail" note for a worktree+mem_id pair —
 * i.e. the review feedback the next `fapony run` should hand back to the executor.
 * Only looks at the latest run for that pair; if it already passed, returns null
 * (nothing to carry forward).
 */
export function getPendingFeedback(
  db: Database,
  worktree: string,
  memId: string,
  excludeRunId?: number,
): string | null {
  const run = db
    .prepare(
      `SELECT * FROM runs WHERE worktree = ? AND mem_id = ? AND id != ? ORDER BY id DESC LIMIT 1`,
    )
    .get(worktree, memId, excludeRunId ?? -1) as Run | null;
  if (run?.status !== "fixing") return null;

  const event = db
    .prepare(
      `SELECT * FROM events WHERE run_id = ? AND kind = 'gate' ORDER BY id DESC LIMIT 1`,
    )
    .get(run.id) as Event | null;
  if (!event?.data) return null;

  try {
    const parsed = JSON.parse(event.data) as {
      verdict?: string;
      note?: string;
    };
    return parsed.verdict === "fail" && parsed.note ? parsed.note : null;
  } catch {
    return null;
  }
}

/**
 * Merge extra fields into the most recent gate event's data JSON.
 * Used by MCP verdict_submit to add reason_code / source after gateOnce
 * has already written the gate event with {verdict, note, round}.
 */
export function patchLastGateEvent(
  db: Database,
  runId: number,
  extra: Record<string, unknown>,
): void {
  const event = db
    .prepare(
      `SELECT id, data FROM events WHERE run_id = ? AND kind = 'gate' ORDER BY id DESC LIMIT 1`,
    )
    .get(runId) as { id: number; data: string | null } | null;
  if (!event) return;

  let existing: Record<string, unknown> = {};
  if (event.data) {
    try {
      existing = JSON.parse(event.data);
    } catch {
      existing = {};
    }
  }
  db.prepare(`UPDATE events SET data = ? WHERE id = ?`).run(
    JSON.stringify({ ...existing, ...extra }),
    event.id,
  );
}
