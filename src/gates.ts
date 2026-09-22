// src/gates.ts — shared per-round gate enrichment (single implementation)
//
// Pairs each gate event with the spawn events in its own round window and
// derives model + canonical quality. Used by stats, telemetry, and
// report-html — never reimplement this pairing elsewhere.
//
// Window rule (read-time join): per gate, model comes only from kind='spawn'
// events in (prevGateId, gateId) of the same run — per-round, never
// cumulative. Events arrive sorted (run_id, id), so one bucketing pass plus a
// forward spawn pointer over the disjoint windows is O(events) total.

import type { Event } from "./core/config.js";
import { qualityScore, VERDICT_GRADES, type VerdictGrade } from "./parse.js";
import {
  findSessionAt,
  findSessionModel,
  loadSessionSpans,
  type SessionClient,
  type SessionSpan,
} from "./session/index.js";

export interface GateWindow {
  runId: number;
  /** Raw verdict string ("" when the gate event has none). */
  verdict: string;
  /** Canonical quality via qualityScore(), or null when grade unknown. */
  quality: number | null;
  /** Executor model from the window's spawns, or null when unknown. */
  model: string | null;
  /** Provider from the gate's session_id (null when unknown or spawn-based). */
  provider: string | null;
  /** Client owning the session log (null when unknown or spawn-based). */
  client: SessionClient | null;
  /** Subagent name, ZCode only (null otherwise, or when spawn-based). */
  agent: string | null;
  /** Round number from the gate event data (defaults to 1). */
  round: number;
  /**
   * Where `model` came from: a spawn event, the gate's own session_id, or
   * inferred from which client session was live in that worktree at that
   * moment. "inferred" is a guess — never present it as declared.
   */
  modelSource: "spawn" | "session_id" | "inferred" | null;
  /**
   * Session the tokens below belong to (null when unknown or spawn-based).
   * Callers that sum tokens MUST dedupe on this: token totals are per session
   * and one session routinely produces several gates.
   */
  sessionId: string | null;
  /** Total input tokens for the session (null when unknown or spawn-based). */
  tokensInput: number | null;
  /** Total output tokens for the session (null when unknown or spawn-based). */
  tokensOutput: number | null;
}

/** SQLite `datetime('now')` output is UTC without a zone marker. */
function eventTimeMs(ts: string): number | null {
  const direct = Date.parse(ts);
  if (!Number.isNaN(direct) && /[zZ]|[+-]\d\d:?\d\d$/.test(ts)) return direct;
  const utc = Date.parse(`${ts.replace(" ", "T")}Z`);
  return Number.isNaN(utc) ? null : utc;
}

function parseEventData(data: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Enrich every gate event with its per-round window.
 * One entry per gate event, in (run_id, id) order.
 */
export function enrichGateWindows(
  events: Event[],
  worktreeByRun?: Map<number, string>,
): GateWindow[] {
  // Spans are loaded per worktree, once, and only when a gate actually needs
  // them — most callers pass no worktree map and pay nothing.
  const spanCache = new Map<string, SessionSpan[]>();
  const spansFor = (worktree: string): SessionSpan[] => {
    let cached = spanCache.get(worktree);
    if (!cached) {
      cached = loadSessionSpans(worktree);
      spanCache.set(worktree, cached);
    }
    return cached;
  };
  const byRun = new Map<number, { gates: Event[]; spawns: Event[] }>();
  for (const e of events) {
    let b = byRun.get(e.run_id);
    if (!b) {
      b = { gates: [], spawns: [] };
      byRun.set(e.run_id, b);
    }
    if (e.kind === "gate") b.gates.push(e);
    else if (e.kind === "spawn") b.spawns.push(e);
  }

  const out: GateWindow[] = [];
  for (const [runId, b] of byRun) {
    let sp = 0;
    for (const g of b.gates) {
      // Pointer only moves forward; everything unconsumed below g.id belongs
      // to this gate's window (prevGateId is implicitly the last consumed id).
      const window: Event[] = [];
      while (sp < b.spawns.length && b.spawns[sp].id < g.id) {
        window.push(b.spawns[sp]);
        sp++;
      }
      const d = parseEventData(g.data);
      const verdict = typeof d.verdict === "string" ? d.verdict : "";
      let model: string | null = null;
      for (const s of window) {
        const sd = parseEventData(s.data);
        if (
          sd.role === "executor" &&
          typeof sd.model === "string" &&
          sd.model
        ) {
          model = sd.model;
        }
      }

      // No spawn in window (the execute→review loop that wrote them is gone):
      // fall back to session_id on the gate event — resolve model + provider
      // + client + agent + tokens from the client's own session log. Spawn-based
      // model always wins when present (the new fields stay null then).
      let provider: string | null = null;
      let client: SessionClient | null = null;
      let agent: string | null = null;
      let sessionId: string | null = null;
      let tokensInput: number | null = null;
      let tokensOutput: number | null = null;
      let modelSource: GateWindow["modelSource"] = model ? "spawn" : null;
      if (model === null && typeof d.session_id === "string" && d.session_id) {
        const resolved = findSessionModel(d.session_id);
        if (resolved) {
          model = resolved.model;
          provider = resolved.provider;
          client = resolved.client;
          agent = resolved.agent;
          sessionId = d.session_id;
          tokensInput = resolved.tokensInput;
          tokensOutput = resolved.tokensOutput;
          modelSource = "session_id";
        }
      }
      // Still nothing: ask which client session was live in this worktree
      // when the verdict landed. Costs the caller no new field and works on
      // rows already stored — see session/activeSession.ts.
      const worktree = worktreeByRun?.get(runId);
      if (model === null && worktree) {
        const atMs = eventTimeMs(g.ts);
        const span =
          atMs === null ? null : findSessionAt(spansFor(worktree), atMs);
        const resolved = span ? findSessionModel(span.sessionId) : null;
        if (resolved) {
          model = resolved.model;
          provider = resolved.provider;
          client = resolved.client;
          agent = resolved.agent;
          sessionId = span ? span.sessionId : null;
          tokensInput = resolved.tokensInput;
          tokensOutput = resolved.tokensOutput;
          modelSource = "inferred";
        }
      }

      const grade = verdict as VerdictGrade;
      const quality = VERDICT_GRADES.has(grade) ? qualityScore(grade) : null;
      const round = typeof d.round === "number" ? d.round : 1;

      out.push({
        runId,
        verdict,
        quality,
        model,
        round,
        provider,
        client,
        agent,
        modelSource,
        sessionId,
        tokensInput,
        tokensOutput,
      });
    }
  }
  return out;
}
