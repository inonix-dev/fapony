// src/telemetry.ts — opt-in aggregate telemetry (P4)
//
// Schema-versioned payload with machine-observed facts only.
// Self-reported metadata (e.g. user tags) are separated from computed aggregates.
// Content fields (plan, commit message, gate note, source, diff) are NEVER included.
//
// §0 rule: every field in the payload is either a structural fact (run count,
// status distribution) or a computed aggregate (avg rounds, pass rate).
// No event/worktree content is ever serialized — the only free text on the
// wire is user-configured telemetry.metadata (self-reported, advisory).

import {
  type Config,
  type Event,
  loadConfig,
  type Run,
} from "./core/config.js";
import { openDb } from "./db/store.js";
import { enrichGateWindows } from "./gates.js";
import { readPassiveUsage } from "./session/index.js";
import { avg, minutesBetween } from "./util.js";

// ─── Schema version ────────────────────────────────────────────────────

/**
 * Telemetry schema version — bumped on every additive change to the payload
 * shape. Receivers must tolerate unknown fields (forward-compatible) but
 * should reject payloads with a version they don't understand.
 *
 * v1 = original (raw run/event rows — DEPRECATED, removed)
 * v2 = aggregate payload with machine-observed facts + self-reported metadata
 * v3 = v2 + derived namespace (tool_call_counts, efficiency_scores, cost_per_quality)
 * v4 = v3 - every declared-cost field (spawn events are no longer written;
 *      cost/avg_cost_usd/efficiency_scores/cost_per_quality are gone)
 */
export const TELEMETRY_SCHEMA_VERSION = 4;

// ─── Retention policy ──────────────────────────────────────────────────

/**
 * Retention: payload is a snapshot at send-time. No history is kept on the
 * sender side beyond what SQLite already stores. Receivers should apply
 * their own retention (recommended: 90 days raw, then aggregate-only).
 *
 * Deletion: sender can delete local runs/events anytime — the payload is
 * already extracted. No "correction" mechanism exists on the wire; receivers
 * should treat payloads as immutable facts.
 *
 * See TELEMETRY.md § Retention for the full policy.
 */

// ─── Machine-observed facts ────────────────────────────────────────────

/**
 * Machine-observed: computed by fapony from DB, never typed by a human.
 * These are the "ground truth" aggregates that receivers can compare against.
 */
export interface MachineObserved {
  /** Total runs in the database at send-time. */
  total_runs: number;
  /** Status distribution: { passed: 5, stalled: 1, ... }. */
  by_status: Record<string, number>;
  /** Pass rate among terminal runs (passed / (passed + stopped + stalled)). */
  pass_rate: number;
  /** Stall rate among terminal runs. */
  stall_rate: number;
  /** Average rounds for passed runs. */
  avg_rounds: number;
  /** Average minutes from creation to last update for passed runs. */
  avg_minutes: number;
  /** Per-model breakdown (executor model only, from spawn events). */
  by_model: Array<{
    model: string;
    gate_count: number;
    avg_quality: number;
  }>;
  /** Per-grade breakdown. */
  by_grade: Array<{
    grade: string;
    count: number;
  }>;
  /** Per-worktree breakdown (paths redacted to basename only). */
  by_worktree: Array<{
    worktree: string;
    runs: number;
    passed: number;
    stalled: number;
  }>;
  /** Derived aggregates (v3+) — activity signals, not quality scores. */
  derived?: DerivedAggregates;
}

// ─── Derived aggregates (v3) ─────────────────────────────────────────

/**
 * Derived from usage-depth queries — activity signals only.
 * All fields are numeric aggregates; no content, no raw rows.
 *
 * `tool_call_counts`: tool-call counts from OpenCode sessions whose project
 * worktree resolves from this DB's run worktree keys via
 * `config.worktrees` — fapony-scoped, never global. Sorted desc by count.
 */
export interface DerivedAggregates {
  /** Scoped tool-call counts (name → count), sorted desc by count. */
  tool_call_counts: Record<string, number>;
}

// ─── Self-reported metadata ────────────────────────────────────────────

/**
 * Self-reported: metadata the user/agent chose to attach. These are NOT
 * computed by fapony and may be inaccurate. Receivers should treat them as
 * advisory, not ground truth.
 *
 * Currently empty — reserved for future fields like:
 * - task_category: "feature" | "bugfix" | "refactor"
 * - stack: "bun" | "node" | "deno"
 * - notes: free-text (always optional)
 *
 * These fields are ONLY included when the user explicitly sets them in
 * fapony.config.json under `telemetry.metadata`.
 */
export interface SelfReported {
  /** Task category (user-set, not inferred). */
  task_category?: string;
  /** Tech stack (user-set). */
  stack?: string;
  /** Free-text notes from the user. */
  notes?: string;
}

// ─── Full payload ──────────────────────────────────────────────────────

export interface TelemetryPayload {
  /** Schema version — receivers must check this. */
  schema_version: number;
  /** ISO-8601 timestamp of payload generation. */
  sent_at: string;
  /** Machine-observed aggregates (ground truth). */
  machine: MachineObserved;
  /** Self-reported metadata (advisory, may be absent). */
  self_reported?: SelfReported;
}

// ─── Payload builder ───────────────────────────────────────────────────

function parseEventData(data: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Build the aggregate telemetry payload from the local SQLite database.
 * No raw rows, no event/worktree content — only computed aggregates plus
 * optional user-configured self-reported metadata.
 */
export function buildPayload(): TelemetryPayload {
  const db = openDb();
  try {
    const runs = db.prepare("SELECT * FROM runs ORDER BY id").all() as Run[];
    const events = db
      .prepare("SELECT * FROM events ORDER BY run_id, id")
      .all() as Event[];

    // --- Runs summary ---
    const byStatus: Record<string, number> = {};
    for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    const terminal = runs.filter((r) =>
      ["passed", "stopped", "stalled"].includes(r.status),
    );
    const passed = runs.filter((r) => r.status === "passed");

    const passRate = terminal.length ? passed.length / terminal.length : 0;
    const stallRate = terminal.length
      ? (byStatus.stalled ?? 0) / terminal.length
      : 0;
    const avgRounds = passed.length
      ? passed.reduce((s, r) => s + r.round, 0) / passed.length
      : 0;
    const avgMinutes = passed.length
      ? passed.reduce(
          (s, r) => s + minutesBetween(r.created_at, r.updated_at),
          0,
        ) / passed.length
      : 0;

    // --- By model (executor spawns only, per-round gate windows) ---
    // Windowing comes from enrichGateWindows (src/gates.ts) — the same
    // disjoint (prevGateId, gateId) windows stats.ts uses, never cumulative.
    const modelBuckets: Record<
      string,
      { gateCount: number; qualities: number[] }
    > = {};

    for (const w of enrichGateWindows(events)) {
      const model = w.model ?? "(unknown)";
      if (!modelBuckets[model]) {
        modelBuckets[model] = { gateCount: 0, qualities: [] };
      }
      modelBuckets[model].gateCount++;
      if (w.quality !== null) {
        modelBuckets[model].qualities.push(w.quality);
      }
    }
    const byModel = Object.entries(modelBuckets)
      .map(([model, b]) => ({
        model,
        gate_count: b.gateCount,
        avg_quality: b.qualities.length ? avg(b.qualities) : 0,
      }))
      .sort((a, b) => b.gate_count - a.gate_count);

    // --- By grade ---
    const gradeBuckets: Record<string, number> = {};
    for (const e of events) {
      if (e.kind !== "gate") continue;
      const d = parseEventData(e.data);
      const grade = typeof d.verdict === "string" ? d.verdict : "(unknown)";
      gradeBuckets[grade] = (gradeBuckets[grade] ?? 0) + 1;
    }
    const byGrade = Object.entries(gradeBuckets)
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => b.count - a.count);

    // --- By worktree (paths redacted to basename) ---
    const wtBuckets: Record<
      string,
      { runs: number; passed: number; stalled: number }
    > = {};
    for (const r of runs) {
      // Redact to basename only — no full paths in telemetry
      const name = r.worktree.split("/").pop() ?? r.worktree;
      const b = (wtBuckets[name] ??= { runs: 0, passed: 0, stalled: 0 });
      b.runs++;
      if (r.status === "passed") b.passed++;
      if (r.status === "stalled") b.stalled++;
    }
    const byWorktree = Object.entries(wtBuckets)
      .map(([worktree, b]) => ({ worktree, ...b }))
      .sort((a, b) => b.runs - a.runs);

    // --- Self-reported metadata (from config) ---
    const config = loadConfig();
    const selfReported: SelfReported | undefined = config.telemetry?.metadata
      ? {
          ...(typeof config.telemetry.metadata.task_category === "string"
            ? { task_category: config.telemetry.metadata.task_category }
            : {}),
          ...(typeof config.telemetry.metadata.stack === "string"
            ? { stack: config.telemetry.metadata.stack }
            : {}),
          ...(typeof config.telemetry.metadata.notes === "string"
            ? { notes: config.telemetry.metadata.notes }
            : {}),
        }
      : undefined;

    // --- Derived aggregates: scoped tool call counts ---
    const derived = buildDerived(resolveTelemetryWorktrees(runs, config));

    return {
      schema_version: TELEMETRY_SCHEMA_VERSION,
      sent_at: new Date().toISOString(),
      machine: {
        total_runs: runs.length,
        by_status: byStatus,
        pass_rate: passRate,
        stall_rate: stallRate,
        avg_rounds: avgRounds,
        avg_minutes: avgMinutes,
        by_model: byModel,
        by_grade: byGrade,
        by_worktree: byWorktree,
        ...(derived ? { derived } : {}),
      },
      ...(selfReported ? { self_reported: selfReported } : {}),
    };
  } finally {
    db.close();
  }
}

// ─── Derived aggregates builder (v3) ─────────────────────────────────

/**
 * Run worktree keys (e.g. "wt-fapony", "mcp-external") resolve to absolute
 * paths via config.worktrees. Only resolvable paths are queried — keys with
 * no mapping (mcp-external, stale keys) contribute nothing, never global.
 */
function resolveTelemetryWorktrees(runs: Run[], config: Config): string[] {
  const paths = new Set<string>();
  for (const r of runs) {
    const p = config.worktrees?.[r.worktree];
    if (typeof p === "string" && p) paths.add(p);
  }
  return [...paths];
}

/**
 * Build derived aggregates from scoped OpenCode usage.
 * Returns null when there's nothing to report (no data).
 */
function buildDerived(worktreePaths: string[]): DerivedAggregates | null {
  // --- tool_call_counts, scoped to this DB's fapony worktrees ---
  const merged: Record<string, number> = {};
  for (const wt of worktreePaths) {
    const usage = readPassiveUsage(wt, undefined, undefined, true);
    const tb = usage.detail?.tool_breakdown ?? {};
    for (const [tool, c] of Object.entries(tb)) {
      merged[tool] = (merged[tool] ?? 0) + c;
    }
  }
  const tool_call_counts: Record<string, number> = {};
  for (const [tool, c] of Object.entries(merged).sort((a, b) => b[1] - a[1])) {
    tool_call_counts[tool] = c;
  }

  return Object.keys(tool_call_counts).length > 0 ? { tool_call_counts } : null;
}

// ─── CLI ───────────────────────────────────────────────────────────────

export async function cmdTelemetry(args: string[]): Promise<void> {
  const sub = args[0];
  const payload = buildPayload();

  if (sub === "show" || !sub) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (sub === "send") {
    const config = loadConfig();
    if (!config.telemetry?.enabled) {
      console.error(
        'telemetry is off — set "telemetry": { "enabled": true, "endpoint": "https://..." } in fapony.config.json to turn it on',
      );
      process.exit(1);
    }
    const res = await fetch(config.telemetry.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`telemetry send failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    console.log(
      `sent schema v${payload.schema_version} telemetry to ${config.telemetry.endpoint} ` +
        `(${payload.machine.total_runs} runs)`,
    );
    return;
  }

  console.error(`fapony telemetry: unknown subcommand "${sub}"`);
  console.error("usage: fapony telemetry <show|send>");
  process.exit(1);
}
