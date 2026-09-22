// src/adapters/hooks/index.ts — re-export all hook adapters

// Re-export hint-log for backwards compatibility.
export {
  type HintFireRow,
  type HintImpact,
  hintLogDir,
  hintLogPath,
  recordHintFire,
  worktreeKey,
} from "../../core/hint-log.js";
// Re-export pure helpers from core for backwards compatibility.
export {
  hookTsMs,
  sessionKey,
  utcStamp,
} from "../../core/hook-helpers.js";
export { computeHintImpact } from "./compute-hint-impact.js";
export {
  type ContextLineData,
  readContextData,
  readContextLines,
} from "./context-data.js";
export {
  cmdHookEditHint,
  type EditHintInput,
  type EditTrackRow,
  editHintFor,
  editTrackPath,
} from "./edit-hint.js";
export {
  GIT_AUTONOMY_COMMIT_POLICY,
  GIT_AUTONOMY_PLUGIN_FILE,
  GIT_AUTONOMY_PLUGIN_NAME,
  GIT_AUTONOMY_SYSTEM_REWRITES,
  GIT_AUTONOMY_TOOL_POLICY,
  GIT_AUTONOMY_TOOL_REWRITES,
  type GitAutonomyRewrite,
  type GitAutonomyStatus,
  type GitAutonomyToolRewrite,
  gitAutonomyStatus,
  rewriteGitAutonomySystem,
  rewriteGitAutonomyTool,
} from "./git-autonomy.js";
export { cmdHookMvGuard, mvGuardDecision } from "./mv-guard.js";
export {
  COMMIT_HINT_MIN_COMMITS,
  type CommitHintInput,
  cmdHookReadHint,
  commitHintFor,
  READ_HINT_MIN_BYTES,
  READ_HINT_MIN_LIMIT,
  type ReadHintInput,
  type ReadTrackRow,
  type RereadHintInput,
  readHintFor,
  readTrackPath,
  rereadHintFor,
} from "./read-hint.js";
export {
  capContext,
  cmdHookSessionStart,
  SESSION_START_MAX_CHARS,
  sessionStartContext,
} from "./session-start.js";
export {
  cmdHookStop,
  cursorTranscriptPath,
  decideStop,
  isCodexPayload,
  isCursorPayload,
  type NormalizedStopInput,
  normalizeStopInput,
  type RawStopPayload,
  type StopClient,
  stopBlockedBefore,
  stopBlockPath,
  stopOutput,
} from "./stop.js";
