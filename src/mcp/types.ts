// src/mcp/types.ts — ToolResult, helpers
// ReasonCode + RegimeCode enums now live in core/enums.ts (PLAN-lib-layer chunk 2c).

// Re-export enums for existing callers.
export {
  REASON_CODES,
  REGIME_CODES,
  type ReasonCode,
  type RegimeCode,
} from "../core/enums.js";

// --- Tool result types ---

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function parseToolResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text);
}
