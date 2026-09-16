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
export {
  findSessionModel,
  type SessionClient,
  type SessionModel,
} from "./findModel.js";
export {
  aggregateDetail,
  buildWhereClause,
  collectTiming,
  type DetailPerSessionToolRow,
  type DetailStepRow,
  type DetailToolRow,
  type ExtractedPartTiming,
  extractPartTiming,
  mergeBytesByTool,
  parseTimeMs,
  readDetailFromDb,
  readTimingFromDb,
  rowFallbackMs,
  summarizeTiming,
  type TimingInput,
  type TimingRow,
  type WhereClause,
} from "./helpers.js";
export { readPassiveUsage } from "./opencode.js";
export { CLIENTS, type ClientAdapter } from "./registry.js";
export {
  EMPTY_RESULT,
  type ModelBreakdown,
  type PassiveUsageReader,
  type PassiveUsageResult,
  type SessionDetail,
  STEP_TOKENS_NOTE,
  type StepTimingSummary,
  TIMING_NOTE,
  type ToolLatencyStat,
  type UsageDetail,
} from "./types.js";
export { readZcodeUsage } from "./zcode.js";
