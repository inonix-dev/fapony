// src/parse.ts — grades, scores, and gate-event JSON parsing.
// Marker-text parsers (parseGateVerdict/parsePlanUpdate) were removed with the
// CLI loop: nothing produces VERDICT:/NEXT-PROMPT/FILE_DONE stdout anymore —
// gate events are JSON, read via parseGateEventData.

/** Locked grade vocabulary — additive-only (append, never rename/remove). */
export type VerdictGrade =
  | "pass-excellent"
  | "pass-good"
  | "pass-adequate"
  | "pass"
  | "fail"
  | "uncertain";

export const VERDICT_GRADES: ReadonlySet<string> = new Set<VerdictGrade>([
  "pass-excellent",
  "pass-good",
  "pass-adequate",
  "pass",
  "fail",
  "uncertain",
]);

/** True when verdict belongs to the pass family (any pass-* variant). */
export function isPassFamily(v: string): v is VerdictGrade {
  return v.startsWith("pass");
}

/**
 * Locked qualityScore mapping — read-time only (never written to events).
 * Values from SPEC-verdict-protocol §qualityScore (additive-only, never change).
 */
const SCORE_MAP: Record<VerdictGrade, number> = {
  "pass-excellent": 5,
  "pass-good": 4,
  "pass-adequate": 3,
  pass: 3,
  fail: 0,
  uncertain: 1,
};

export function qualityScore(grade: VerdictGrade): number {
  return SCORE_MAP[grade] ?? 0;
}

export interface GateVerdict {
  verdict: VerdictGrade;
  note: string;
}

/**
 * Read a verdict back from a stored gate event (`kind='gate'`).
 * Gate events are JSON (`{verdict, note, round}` from gateOnce) — NOT
 * reviewer stdout. Returns null for missing/unparseable data or unknown grades.
 */
export function parseGateEventData(data: string | null): GateVerdict | null {
  if (!data) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { verdict, note } = parsed as { verdict?: unknown; note?: unknown };
  if (typeof verdict !== "string" || !VERDICT_GRADES.has(verdict)) return null;
  return {
    verdict: verdict as VerdictGrade,
    note: typeof note === "string" ? note : "",
  };
}
