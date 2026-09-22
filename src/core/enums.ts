// src/core/enums.ts — ReasonCode + RegimeCode enums (pure constants, no imports)
//
// Extracted from src/mcp/types.ts (PLAN-lib-layer chunk 2c) to break the
// stats→mcp dependency. These enums are used by stats/data.ts, mcp/types.ts,
// and context/projectHealth.ts — core is the neutral home.

// --- ReasonCode enum (locked in step 0, append-only) ---

export const REASON_CODES = [
  "missing_test",
  "scope_mismatch",
  "unsafe_command",
  "spec_gap",
  "timeout",
  "blocked",
  "incomplete",
  "none",
  "other",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

// --- RegimeCode enum (task-shape axis for model × project × regime × quality) ---

export const REGIME_CODES = [
  "code",
  "fix",
  "review",
  "plan",
  "inquiry",
  "test",
] as const;

export type RegimeCode = (typeof REGIME_CODES)[number];
