// src/session/helpers.ts — shared patterns for session usage providers
//
// Both OpenCode and ZCode (and future SQLite-backed providers) share:
// 1. WHERE-clause building with worktree/since/until filters
// 2. Detail aggregation: tool + step rows → UsageDetail shape
//
// The join column for worktree differs per provider (OpenCode: pr.worktree,
// ZCode: s.directory) — callers supply the column name.

import type { Database } from "bun:sqlite";
import type { SessionDetail, StepTimingSummary, UsageDetail } from "./types.js";
import { STEP_TOKENS_NOTE, TIMING_NOTE } from "./types.js";

// ─── WHERE clause builder ──────────────────────────────────────────────

export interface WhereClause {
  /** SQL fragment: either `AND ...` or empty string. */
  clause: string;
  /** Bound parameters in order. */
  params: (string | number)[];
}

/**
 * Build a WHERE / AND filter clause for (worktree, since, until).
 *
 * @param worktreeCol - Column to match the worktree path (e.g. `pr.worktree` or `s.directory`).
 * @param worktree - Optional worktree path filter.
 * @param since - Optional lower bound for `s.time_created`.
 * @param until - Optional upper bound for `s.time_created`.
 * @param prefix - `"WHERE"` when this is the only filter block, `"AND"` when appended to existing WHERE.
 */
export function buildWhereClause(
  worktreeCol: string,
  worktree?: string,
  since?: number,
  until?: number,
  prefix: "WHERE" | "AND" = "AND",
): WhereClause {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (worktree) {
    conds.push(`${worktreeCol} = ?`);
    params.push(worktree);
  }
  if (since !== undefined) {
    conds.push("s.time_created >= ?");
    params.push(since);
  }
  if (until !== undefined) {
    conds.push("s.time_created <= ?");
    params.push(until);
  }
  return {
    clause: conds.length > 0 ? `${prefix} ${conds.join(" AND ")}` : "",
    params,
  };
}

// ─── Detail aggregation ────────────────────────────────────────────────

export interface DetailToolRow {
  tool: string | null;
  c: number;
}

export interface DetailStepRow {
  sid: string;
  model: string | null;
  steps: number;
}

export interface DetailPerSessionToolRow {
  sid: string;
  tool: string | null;
  c: number;
}

export interface DetailBytesRow {
  tool: string | null;
  /** Summed `state.output` length (context bytes consumed by tool results). */
  b: number;
}

/**
 * Aggregate tool + step query results into a UsageDetail.
 *
 * This is the shared logic between OpenCode's `readUsageDetail()` and
 * ZCode's `readZcodeUsageDetail()`. Both query:
 * - tool rows (tool name + count)
 * - step rows (session id + model + step count)
 * - per-session tool rows (session id + tool + count)
 * then merge into the same UsageDetail shape via a Map.
 */
export function aggregateDetail(
  toolRows: DetailToolRow[],
  stepsRow: { steps: number },
  perSessionSteps: DetailStepRow[],
  perSessionTools: DetailPerSessionToolRow[],
  fallbackModelLookup?: Array<{ sid: string; model: string | null }>,
  bytesRows?: DetailBytesRow[],
): UsageDetail {
  const tool_breakdown: Record<string, number> = {};
  for (const r of toolRows) {
    const name = typeof r.tool === "string" && r.tool ? r.tool : "(unknown)";
    tool_breakdown[name] = r.c;
  }

  const bySessionMap = new Map<string, SessionDetail>();
  for (const r of perSessionSteps) {
    bySessionMap.set(r.sid, {
      session_id: r.sid,
      model: typeof r.model === "string" ? r.model : "(unknown)",
      steps: r.steps,
      tools: {},
    });
  }
  for (const r of perSessionTools) {
    let entry = bySessionMap.get(r.sid);
    if (!entry) {
      entry = { session_id: r.sid, model: "(unknown)", steps: 0, tools: {} };
      bySessionMap.set(r.sid, entry);
    }
    const name = typeof r.tool === "string" && r.tool ? r.tool : "(unknown)";
    entry.tools[name] = r.c;
  }

  // Backfill model for sessions that have tools but no step-finish rows.
  if (fallbackModelLookup) {
    for (const r of fallbackModelLookup) {
      const entry = bySessionMap.get(r.sid);
      if (entry && typeof r.model === "string" && r.model)
        entry.model = r.model;
    }
  }

  const bytesByTool: Record<string, number> = {};
  for (const r of bytesRows ?? []) {
    if (typeof r.b !== "number" || r.b <= 0) continue;
    const name = typeof r.tool === "string" && r.tool ? r.tool : "(unknown)";
    bytesByTool[name] = (bytesByTool[name] ?? 0) + r.b;
  }

  const detail: UsageDetail = {
    tool_breakdown,
    steps: stepsRow?.steps ?? 0,
    by_session: [...bySessionMap.values()]
      .filter((s) => s.steps > 0)
      .sort((a, b) => b.steps - a.steps),
    note: STEP_TOKENS_NOTE,
  };
  if (Object.keys(bytesByTool).length > 0) detail.bytes_by_tool = bytesByTool;
  return detail;
}

/**
 * Sum `bytes_by_tool` across any number of UsageDetail objects (or nulls).
 * Claude Code, Codex and the SQLite providers (OpenCode/ZCode) all populate
 * the field now, so callers still pass every client's detail (opencode +
 * zcode + claude_code + codex) and never just the top-level one.
 * Returns {} when no client reported bytes.
 */
export function mergeBytesByTool(
  ...details: Array<UsageDetail | null | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of details) {
    const bbt = d?.bytes_by_tool;
    if (!bbt || typeof bbt !== "object") continue;
    for (const [tool, bytes] of Object.entries(bbt)) {
      if (typeof bytes !== "number" || bytes <= 0) continue;
      out[tool] = (out[tool] ?? 0) + bytes;
    }
  }
  return out;
}

// ─── SQLite detail reader ──────────────────────────────────────────────

/**
 * SQL join fragment for the session→project link.
 * OpenCode needs `JOIN project pr ON pr.id = s.project_id`.
 * ZCode doesn't (worktree is on the session table directly).
 */
function joinClause(needsProject: boolean): string {
  return needsProject ? "JOIN project pr ON pr.id = s.project_id" : "";
}

/**
 * Run detail queries against a SQLite DB and return UsageDetail.
 *
 * Providers supply the worktree column name. If it starts with `pr.`,
 * the project join is included automatically. The model column for
 * per-session queries is configurable (OpenCode: `s.model`, ZCode: `s.directory`).
 *
 * @param db - Open SQLite connection (readonly).
 * @param worktreeCol - e.g. `pr.worktree` (OpenCode) or `s.directory` (ZCode).
 * @param modelCol - Column for the model in per-session queries (e.g. `s.model` or `s.directory`).
 * @param worktree - Optional worktree path filter.
 * @param since - Optional lower bound.
 * @param until - Optional upper bound.
 */
export function readDetailFromDb(
  db: Database,
  worktreeCol: string,
  modelCol: string,
  worktree?: string,
  since?: number,
  until?: number,
): UsageDetail {
  const join = joinClause(worktreeCol.startsWith("pr."));
  const filter = buildWhereClause(worktreeCol, worktree, since, until);
  // Only OpenCode keeps a model on the session row to backfill from; it used to
  // be inferred from the `pr.` worktree column, which no longer identifies it.
  const canBackfillModel = modelCol === "s.model";

  const toolRows = db
    .prepare(
      `
      SELECT json_extract(p.data, '$.tool') AS tool, COUNT(*) AS c
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'tool'
      ${filter.clause}
      GROUP BY tool
      ORDER BY c DESC
    `,
    )
    .all(...filter.params) as DetailToolRow[];

  const stepsRow = db
    .prepare(
      `
      SELECT COUNT(*) AS steps
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'step-finish'
      ${filter.clause}
    `,
    )
    .get(...filter.params) as { steps: number };

  const perSessionSteps = db
    .prepare(
      `
      SELECT p.session_id AS sid, ${modelCol} AS model, COUNT(*) AS steps
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'step-finish'
      ${filter.clause}
      GROUP BY sid
    `,
    )
    .all(...filter.params) as DetailStepRow[];

  const perSessionTools = db
    .prepare(
      `
      SELECT p.session_id AS sid, json_extract(p.data, '$.tool') AS tool, COUNT(*) AS c
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'tool'
      ${filter.clause}
      GROUP BY sid, tool
    `,
    )
    .all(...filter.params) as DetailPerSessionToolRow[];

  // Context bytes per tool — summed `state.output` length. Same signal the
  // Claude Code/Codex readers derive from tool_result blocks, so usage-scan
  // stops reporting zero bytes for the SQLite clients.
  const bytesRows = db
    .prepare(
      `
      SELECT json_extract(p.data, '$.tool') AS tool,
             SUM(length(COALESCE(json_extract(p.data, '$.state.output'), ''))) AS b
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'tool'
      ${filter.clause}
      GROUP BY tool
    `,
    )
    .all(...filter.params) as DetailBytesRow[];

  // Backfill model for sessions with tools but no step-finish rows.
  let fallbackModelLookup:
    | Array<{ sid: string; model: string | null }>
    | undefined;
  if (canBackfillModel) {
    const toolSids = [...new Set(perSessionTools.map((r) => r.sid))];
    const stepSids = new Set(perSessionSteps.map((r) => r.sid));
    const missingModel = toolSids.filter((sid) => !stepSids.has(sid));
    if (missingModel.length > 0) {
      const placeholders = missingModel.map(() => "?").join(",");
      fallbackModelLookup = db
        .prepare(
          `SELECT id AS sid, model AS model FROM session WHERE id IN (${placeholders})`,
        )
        .all(...missingModel) as Array<{ sid: string; model: string | null }>;
    }
  }

  return aggregateDetail(
    toolRows,
    stepsRow,
    perSessionSteps,
    perSessionTools,
    fallbackModelLookup,
    bytesRows,
  );
}

// ─── Timing extraction (PLAN-project-health-context step 3) ────────────
//
// Parses fields the clients already write — no client-side change:
// - OpenCode part.data.time.start/end (tool, reasoning parts) → duration
// - OpenCode part.data.state.time.start/end (tool parts) → tool latency
// - OpenCode part.data.tokens.{input,output} + data.cost (step-finish) → per-step tokens
// - Claude Code JSONL timestamp diffs + message.usage (via summarizeTiming)
// Row time_created/time_updated is the fallback when embedded time is absent
// (spec §1 risk row). Only aggregates leave this module — never raw I/O.

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** ISO string, epoch-ms, or epoch-s → ms epoch. Null when unparseable. */
export function parseTimeMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 1e13 || v < 0) return null;
    return v >= 1e12 ? v : v * 1000;
  }
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export interface ExtractedPartTiming {
  partType: string | null;
  durationMs: number | null;
  toolName: string | null;
  toolLatencyMs: number | null;
  stepInput: number | null;
  stepOutput: number | null;
  stepCost: number | null;
}

/** Pull timing/token signals out of one part.data JSON blob. */
export function extractPartTiming(dataJson: string): ExtractedPartTiming {
  const out: ExtractedPartTiming = {
    partType: null,
    durationMs: null,
    toolName: null,
    toolLatencyMs: null,
    stepInput: null,
    stepOutput: null,
    stepCost: null,
  };
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(dataJson) as Record<string, unknown>;
  } catch {
    return out;
  }
  if (!d || typeof d !== "object") return out;
  if (typeof d.type === "string") out.partType = d.type;

  // Duration: data.time.start/end (tool, reasoning parts).
  const t = d.time as Record<string, unknown> | undefined;
  if (t && typeof t === "object") {
    const start = parseTimeMs(t.start);
    const end = parseTimeMs(t.end);
    if (start !== null && end !== null && end >= start)
      out.durationMs = end - start;
  }

  // Tool latency: data.state.time.start/end, grouped by data.tool.
  if (typeof d.tool === "string" && d.tool) out.toolName = d.tool;
  const st = d.state as Record<string, unknown> | undefined;
  const stt =
    st && typeof st === "object"
      ? (st.time as Record<string, unknown> | undefined)
      : undefined;
  if (stt && typeof stt === "object") {
    const start = parseTimeMs(stt.start);
    const end = parseTimeMs(stt.end);
    if (start !== null && end !== null && end >= start)
      out.toolLatencyMs = end - start;
  }

  // Per-step tokens: data.tokens + data.cost on step-finish rows.
  const tok = d.tokens as Record<string, unknown> | undefined;
  if (tok && typeof tok === "object") {
    out.stepInput = numOrNull(tok.input ?? tok.input_tokens);
    out.stepOutput = numOrNull(tok.output ?? tok.output_tokens);
  }
  out.stepCost = numOrNull(d.cost);
  return out;
}

export interface TimingInput {
  /** Per-part durations in ms (null = no time signal on that part). */
  durationsMs: Array<number | null>;
  /** One entry per step-finish row. */
  stepTokens: Array<{
    input: number | null;
    output: number | null;
    cost: number | null;
  }>;
  /** One entry per tool call with a measured latency. */
  toolLatencies: Array<{ tool: string; ms: number }>;
  /** step-finish row count (mirrors UsageDetail.steps). */
  steps: number;
}

function avgOrNull(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Summarize provider-extracted timing arrays. Shared by the SQLite readers
 * (OpenCode/ZCode) and the JSONL readers (Claude Code) so the shape never
 * drifts per provider. Averages only — per-step tokens are never summed.
 */
export function summarizeTiming(input: TimingInput): StepTimingSummary {
  const measured = input.durationsMs.filter((x): x is number => x !== null);
  const latByTool = new Map<string, number[]>();
  for (const l of input.toolLatencies) {
    let arr = latByTool.get(l.tool);
    if (!arr) {
      arr = [];
      latByTool.set(l.tool, arr);
    }
    arr.push(l.ms);
  }
  const toolLatencyMsByType: StepTimingSummary["toolLatencyMsByType"] = {};
  for (const [tool, arr] of latByTool) {
    const avg = avgOrNull(arr);
    if (avg !== null)
      toolLatencyMsByType[tool] = { count: arr.length, avgMs: avg };
  }
  return {
    steps: input.steps,
    avgStepMs: avgOrNull(measured),
    stepSamples: measured.length,
    avgStepInput: avgOrNull(
      input.stepTokens
        .map((s) => s.input)
        .filter((x): x is number => x !== null),
    ),
    avgStepOutput: avgOrNull(
      input.stepTokens
        .map((s) => s.output)
        .filter((x): x is number => x !== null),
    ),
    avgStepCost: avgOrNull(
      input.stepTokens
        .map((s) => s.cost)
        .filter((x): x is number => x !== null),
    ),
    toolLatencyMsByType,
    note: TIMING_NOTE,
  };
}

export interface TimingRow {
  data: string;
  time_created: number | null;
  /** Null when the provider's part table has no time_updated column (ZCode). */
  time_updated: number | null;
}

/**
 * Row-timestamp fallback for one part. Unit comes from the magnitude of the
 * stamps themselves (epoch-s vs epoch-ms), not the diff — a 500 diff is 500s
 * in seconds-stamps but 500ms in ms-stamps. Null when the pair is missing
 * or inverted — never throws, never negative.
 */
export function rowFallbackMs(
  created: number | null,
  updated: number | null,
): number | null {
  if (created === null || updated === null) return null;
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(updated) ||
    updated < created
  )
    return null;
  const diff = updated - created;
  return created >= 1e12 ? diff : diff * 1000;
}

/** Fold extracted part rows into a TimingInput (embedded + row fallback). */
export function collectTiming(rows: TimingRow[]): TimingInput {
  const durationsMs: Array<number | null> = [];
  const stepTokens: TimingInput["stepTokens"] = [];
  const toolLatencies: TimingInput["toolLatencies"] = [];
  let steps = 0;
  for (const r of rows) {
    const t = extractPartTiming(r.data);
    // Step count mirrors UsageDetail.steps: every step-finish row counts,
    // even when it carries no tokens (tokens stay null, never summed).
    if (t.partType === "step-finish") {
      steps++;
      stepTokens.push({
        input: t.stepInput,
        output: t.stepOutput,
        cost: t.stepCost,
      });
    }
    if (t.toolName !== null && t.toolLatencyMs !== null)
      toolLatencies.push({ tool: t.toolName, ms: t.toolLatencyMs });
    durationsMs.push(
      t.durationMs ?? rowFallbackMs(r.time_created, r.time_updated),
    );
  }
  return { durationsMs, stepTokens, toolLatencies, steps };
}

/**
 * Run the timing query against a SQLite DB and return a StepTimingSummary.
 *
 * Same join/filter as readDetailFromDb. `hasTimeUpdated` is false for
 * providers whose part table has no time_updated column (ZCode) — the row
 * fallback then degrades to embedded-only. Read-only like all session
 * readers (caller holds PRAGMA query_only).
 */
/** Default row cap for readTimingFromDb sampling — recent parts only, not a full scan. */
export const DEFAULT_TIMING_SAMPLE_LIMIT = 20_000;

export function readTimingFromDb(
  db: Database,
  worktreeCol: string,
  opts?: {
    worktree?: string;
    since?: number;
    until?: number;
    hasTimeUpdated?: boolean;
    /** Cap rows scanned, most recent first. `false`/omitted disables the cap (full scan). */
    limit?: number | false;
  },
): StepTimingSummary {
  const needsProject = worktreeCol.startsWith("pr.");
  const join = joinClause(needsProject);
  const filter = buildWhereClause(
    worktreeCol,
    opts?.worktree,
    opts?.since,
    opts?.until,
  );
  const updatedCol =
    opts?.hasTimeUpdated === false
      ? "NULL AS time_updated"
      : "p.time_updated AS time_updated";
  // ponytail: sampling caps JS-side JSON.parse cost (the real bottleneck on
  // large part tables) — ORDER BY + LIMIT keeps it a fast index scan, not a
  // full table scan. Pass limit:false for an exact full-scan run.
  const limitClause =
    opts?.limit === false ? "" : "ORDER BY p.time_created DESC LIMIT ?";
  const limitParams =
    opts?.limit === false ? [] : [opts?.limit ?? DEFAULT_TIMING_SAMPLE_LIMIT];
  const rows = db
    .prepare(
      `
      SELECT p.data AS data, p.time_created AS time_created, ${updatedCol}
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE (json_extract(p.data, '$.type') = 'tool'
         OR json_extract(p.data, '$.type') = 'step-finish'
         OR json_extract(p.data, '$.type') = 'reasoning')
      ${filter.clause}
      ${limitClause}
    `,
    )
    .all(...filter.params, ...limitParams) as Array<{
    data: string;
    time_created: number | null;
    time_updated: number | null;
  }>;
  return summarizeTiming(
    collectTiming(
      rows.map((r) => ({
        data: typeof r.data === "string" ? r.data : "",
        time_created:
          typeof r.time_created === "number" ? r.time_created : null,
        time_updated:
          typeof r.time_updated === "number" ? r.time_updated : null,
      })),
    ),
  );
}

// ─── Read snapshot ─────────────────────────────────────────────────────

/**
 * Pin ONE read snapshot for a multi-query read, but only under WAL.
 *
 * A client writes its session log while we read it, so totals, detail and
 * timing can each land on a different state of the DB and disagree with each
 * other. A deferred read transaction gives every query below the same
 * snapshot.
 *
 * ponytail: WAL only. Without WAL the SHARED lock this takes can make the
 * *client's own* write fail with SQLITE_BUSY — consistent numbers are never
 * worth breaking the thing we are measuring. Non-WAL just reads unpinned,
 * exactly as before. Returns whether a transaction was opened; pass that to
 * endSnapshot() in a finally.
 */
export function beginSnapshot(db: Database): boolean {
  try {
    const row = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode?: string;
    } | null;
    if (row?.journal_mode?.toLowerCase() !== "wal") return false;
    db.run("BEGIN DEFERRED");
    return true;
  } catch {
    return false;
  }
}

/** End a beginSnapshot() transaction. No-op when none was opened. */
export function endSnapshot(db: Database, open: boolean): void {
  if (!open) return;
  try {
    db.run("COMMIT");
  } catch {
    // Read-only transaction — nothing to roll back, and we are closing anyway.
  }
}
