// src/session/opencode.ts — OpenCode passive usage reader
//
// Reads ~/.local/share/opencode/opencode.db (SQLite).
// Schema: session + project + part tables.

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

const DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

function resolveDbPath(optDbPath?: string): string {
  return optDbPath ?? process.env.FAPONY_OPENCODE_DB ?? DB_PATH;
}

/**
 * Read passive usage from OpenCode's session database.
 * Returns EMPTY_RESULT when the DB file doesn't exist.
 */
export function readPassiveUsage(
  worktree?: string,
  since?: number,
  until?: number,
  detailOrOpts?:
    | boolean
    | { detail?: boolean; dbPath?: string; full?: boolean },
): PassiveUsageResult {
  const detail =
    typeof detailOrOpts === "boolean" ? detailOrOpts : !!detailOrOpts?.detail;
  const full = typeof detailOrOpts === "object" && !!detailOrOpts?.full;
  const dbPath =
    typeof detailOrOpts === "object"
      ? resolveDbPath(detailOrOpts.dbPath)
      : resolveDbPath();
  if (!existsSync(dbPath)) {
    return EMPTY_RESULT;
  }

  let db: Database | null = null;
  let snapshot = false;
  try {
    db = new Database(dbPath, { readonly: true });
    db.run("PRAGMA query_only = ON");
    snapshot = beginSnapshot(db);

    // OpenCode's `project.worktree` is the repo ROOT, so a git worktree under it
    // (…/fapony/wt-fapony) never matches and every per-project query came back
    // empty. `session.directory` is the actual cwd — the same value runs.worktree
    // holds. ponytail: filter on the session row, keep the join for by-model.
    const filter = buildWhereClause(
      "s.directory",
      worktree,
      since,
      until,
      "WHERE",
    );

    const totalsRow = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(s.tokens_input), 0) AS total_tokens_input,
          COALESCE(SUM(s.tokens_output), 0) AS total_tokens_output,
          COALESCE(SUM(s.tokens_reasoning), 0) AS total_tokens_reasoning,
          COALESCE(SUM(s.tokens_cache_read), 0) AS total_tokens_cache_read,
          COALESCE(SUM(s.tokens_cache_write), 0) AS total_tokens_cache_write,
          COALESCE(SUM(s.cost), 0) AS total_cost,
          COUNT(*) AS session_count
        FROM session s
        JOIN project p ON s.project_id = p.id
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

    if (!totalsRow || totalsRow.session_count === 0) {
      return EMPTY_RESULT;
    }

    const byModelRows = db
      .prepare(
        `
        SELECT
          CASE WHEN json_valid(s.model) THEN COALESCE(json_extract(s.model, '$.providerID'), '') ELSE '' END AS provider,
          CASE WHEN json_valid(s.model) THEN COALESCE(json_extract(s.model, '$.id'), s.model) ELSE s.model END AS model,
          COUNT(*) AS session_count,
          SUM(s.tokens_input) AS tokens_input,
          SUM(s.tokens_output) AS tokens_output,
          SUM(s.tokens_reasoning) AS tokens_reasoning,
          SUM(s.tokens_cache_read) AS tokens_cache_read,
          SUM(s.tokens_cache_write) AS tokens_cache_write,
          SUM(s.cost) AS cost
        FROM session s
        JOIN project p ON s.project_id = p.id
        ${filter.clause}
        GROUP BY CASE WHEN json_valid(s.model) THEN COALESCE(json_extract(s.model, '$.providerID'), '') ELSE '' END,
                 CASE WHEN json_valid(s.model) THEN COALESCE(json_extract(s.model, '$.id'), s.model) ELSE s.model END
        ORDER BY (tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write) DESC
      `,
      )
      .all(...filter.params) as ModelBreakdown[];

    const result: PassiveUsageResult = {
      total_tokens_input: totalsRow.total_tokens_input,
      total_tokens_output: totalsRow.total_tokens_output,
      total_tokens_reasoning: totalsRow.total_tokens_reasoning,
      total_tokens_cache_read: totalsRow.total_tokens_cache_read,
      total_tokens_cache_write: totalsRow.total_tokens_cache_write,
      total_cost: totalsRow.total_cost,
      session_count: totalsRow.session_count,
      by_model: byModelRows,
    };

    if (detail) {
      result.detail = readDetailFromDb(
        db,
        "s.directory",
        "s.model",
        worktree,
        since,
        until,
      );
      try {
        result.detail.timing = readTimingFromDb(db, "s.directory", {
          worktree,
          since,
          until,
          limit: full ? false : undefined,
        });
      } catch {
        // Timing is additive signal — a part-table shape mismatch must
        // never break totals/detail that already succeeded. Say so instead of
        // letting a silent null read as "this client records no timing".
        result.detail.timing = null;
        result.error = "opencode_timing_read_failed";
      }
    }

    return result;
  } catch {
    return { ...EMPTY_RESULT, error: "opencode_read_failed" };
  } finally {
    if (db) endSnapshot(db, snapshot);
    db?.close();
  }
}
