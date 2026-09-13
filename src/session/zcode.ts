// src/session/zcode.ts — ZCode passive usage reader
//
// Reads ~/.zcode/cli/db/db.sqlite (SQLite).
// Schema: session + model_usage + part tables (different from OpenCode).
// Worktree lives on session.directory, not a separate project table.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  beginSnapshot,
  buildWhereClause,
  endSnapshot,
  readDetailFromDb,
  readTimingFromDb,
} from "./helpers.js";
import {
  EMPTY_RESULT,
  type ModelBreakdown,
  type PassiveUsageResult,
} from "./types.js";

const ZCODE_DB_PATH = join(homedir(), ".zcode", "cli", "db", "db.sqlite");

function resolveZcodeDbPath(optDbPath?: string): string {
  return optDbPath ?? process.env.FAPONY_ZCODE_DB ?? ZCODE_DB_PATH;
}

/**
 * Read passive usage from ZCode's own session DB.
 * Returns EMPTY_RESULT when the DB file doesn't exist (ZCode never started).
 */
export function readZcodeUsage(
  worktree?: string,
  since?: number,
  until?: number,
  detail?: boolean,
  full?: boolean,
): PassiveUsageResult {
  const dbPath = resolveZcodeDbPath();
  if (!existsSync(dbPath)) return EMPTY_RESULT;

  let db: Database | null = null;
  let snapshot = false;
  try {
    db = new Database(dbPath, { readonly: true });
    db.run("PRAGMA query_only = ON");
    snapshot = beginSnapshot(db);

    const filter = buildWhereClause("s.directory", worktree, since, until);

    const totalsRow = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(mu.input_tokens), 0) AS total_tokens_input,
          COALESCE(SUM(mu.output_tokens), 0) AS total_tokens_output,
          COALESCE(SUM(mu.reasoning_tokens), 0) AS total_tokens_reasoning,
          COALESCE(SUM(mu.cache_read_input_tokens), 0) AS total_tokens_cache_read,
          COALESCE(SUM(mu.cache_creation_input_tokens), 0) AS total_tokens_cache_write,
          0 AS total_cost,
          COUNT(DISTINCT s.id) AS session_count
        FROM model_usage mu
        JOIN session s ON mu.session_id = s.id
        ${filter.clause}
      `,
      )
      .get(...filter.params) as {
      total_tokens_input: number;
      total_tokens_output: number;
      total_tokens_reasoning: number;
      total_tokens_cache_read: number;
      total_tokens_cache_write: number;
      total_cost: number;
      session_count: number;
    };

    if (!totalsRow || totalsRow.session_count === 0) return EMPTY_RESULT;

    const byModelRows = db
      .prepare(
        `
        SELECT
          '' AS provider,
          mu.model_id AS model,
          COUNT(DISTINCT s.id) AS session_count,
          SUM(mu.input_tokens) AS tokens_input,
          SUM(mu.output_tokens) AS tokens_output,
          SUM(mu.reasoning_tokens) AS tokens_reasoning,
          SUM(mu.cache_read_input_tokens) AS tokens_cache_read,
          SUM(mu.cache_creation_input_tokens) AS tokens_cache_write,
          0 AS cost
        FROM model_usage mu
        JOIN session s ON mu.session_id = s.id
        ${filter.clause}
        GROUP BY mu.model_id
        ORDER BY SUM(mu.computed_total_tokens) DESC
      `,
      )
      .all(...filter.params) as ModelBreakdown[];

    const result: PassiveUsageResult = {
      total_tokens_input: totalsRow.total_tokens_input,
      total_tokens_output: totalsRow.total_tokens_output,
      total_tokens_reasoning: totalsRow.total_tokens_reasoning,
      total_tokens_cache_read: totalsRow.total_tokens_cache_read,
      total_tokens_cache_write: 0, // ZCode doesn't separately track cache write
      total_cost: totalsRow.total_cost,
      session_count: totalsRow.session_count,
      by_model: byModelRows,
    };

    if (detail) {
      result.detail = readDetailFromDb(
        db,
        "s.directory",
        "s.directory",
        worktree,
        since,
        until,
      );
      // ZCode part table has no time_updated column (spec §1: verify before
      // coding) — embedded data.time only, row fallback disabled.
      // ASSUMPTION: ZCode part.data.type uses the same vocabulary as OpenCode
      // ("tool", "step-finish", "reasoning"). If ZCode uses different type
      // strings, timing silently returns empty (graceful degradation, no error).
      try {
        result.detail.timing = readTimingFromDb(db, "s.directory", {
          worktree,
          since,
          until,
          hasTimeUpdated: false,
          limit: full ? false : undefined,
        });
      } catch {
        // Timing is additive signal — never break totals/detail. The code
        // distinguishes "ZCode records no timing" from "we could not read it".
        result.detail.timing = null;
        result.error = "zcode_timing_read_failed";
      }
    }

    return result;
  } catch {
    return { ...EMPTY_RESULT, error: "zcode_read_failed" };
  } finally {
    if (db) endSnapshot(db, snapshot);
    db?.close();
  }
}
