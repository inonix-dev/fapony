import type { Config } from "./types.js";

export const DEFAULT_SAFETY_DENY = [
  "reset\\s+--hard",
  "clean\\s+-[a-z]*f",
  "checkout\\s+--\\s",
  "git\\s+stash",
];
export const DEFAULT_PLAN_DIR = ".fapony/plan";
export const DEFAULT_SPEC_DIR = ".fapony/spec";
// Archive sits beside plan/, not inside it, so archiving never changes a file's
// depth and its relative links survive the move untouched.
export const DEFAULT_DONE_DIR = ".fapony/done";
export const DEFAULT_MEM_DIR = ".fapony/.memory";
export const DEFAULT_EVIDENCE_FILE = ".fapony/evidence.json";

export const DEFAULT_CONFIG: Config = {
  worktrees: {},
  review: {
    maxRounds: 2,
  },
  memory: null,
  telemetry: null,
  paths: null,
  safety: null,
};
