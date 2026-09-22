// src/mcp/types.ts — ToolResult, helpers
// ReasonCode + RegimeCode enums now live in core/enums.ts (PLAN-lib-layer chunk 2c).

// Re-export enums for existing callers.
export {
  REASON_CODES,
  REGIME_CODES,
  type ReasonCode,
  type RegimeCode,
} from "../core/enums.js";

// Re-export ToolResult types for existing callers.
export {
  errorResult,
  jsonResult,
  parseToolResult,
  type ToolResult,
} from "../core/types.js";
