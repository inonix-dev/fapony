// src/session/index.ts — re-exports for backward-compatible imports
//
// All callers that do `import { readPassiveUsage } from "./session.js"`
// will resolve here after src/session.ts is deleted.

export {
  claudeProjectSlug,
  findSessionAt,
  loadSessionSpans,
  type SessionSpan,
} from "./activeSession.js";
export { readClaudeCodeUsage } from "./claude-code.js";
export { readCodexUsage } from "./codex.js";
export { findSessionModel, type SessionClient } from "./findModel.js";
export {
  collectTiming,
  extractPartTiming,
  mergeBytesByTool,
  parseTimeMs,
  rowFallbackMs,
  summarizeTiming,
} from "./helpers.js";
export { readPassiveUsage } from "./opencode.js";
export { CLIENTS } from "./registry.js";
export {
  EMPTY_RESULT,
  type ModelBreakdown,
  type PassiveUsageResult,
  type UsageDetail,
} from "./types.js";
export { readZcodeUsage } from "./zcode.js";
