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
