import type { Config } from "./types.js";

export { DEFAULT_SAFETY_DENY } from "../core/defaults.js";
// --- .fapony/ layout (single source of truth — do not hardcode ".fapony" elsewhere) ---
// plan/spec live in .fapony/ — not configurable (gitignored = private).
export const FAPONY_DIR = ".fapony";
export const CONFIG_FILENAME = "fapony.config.json";
export const CONVENTIONS_FILENAME = "conventions.json";
export const EVIDENCE_FILENAME = "evidence.json";
export const CONVENTIONS_FILE = `${FAPONY_DIR}/${CONVENTIONS_FILENAME}`;
// plan/spec live in .fapony/ — not configurable (gitignored = private).
export const PLAN_DIR = `${FAPONY_DIR}/plan`;
export const SPEC_DIR = `${FAPONY_DIR}/spec`;
// Archive sits beside plan/, not inside it, so archiving never changes a file's
// depth and its relative links survive the move untouched.
export const DEFAULT_DONE_DIR = `${FAPONY_DIR}/done`;
export const DEFAULT_MEM_DIR = `${FAPONY_DIR}/.memory`;
export const DEFAULT_EVIDENCE_FILE = `${FAPONY_DIR}/${EVIDENCE_FILENAME}`;

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
