import {
  DEFAULT_DONE_DIR,
  DEFAULT_EVIDENCE_FILE,
  DEFAULT_MEM_DIR,
  DEFAULT_SAFETY_DENY,
  PLAN_DIR,
  SPEC_DIR,
} from "./defaults.js";
import type { Config } from "./types.js";

export function safetyDeny(config?: Config): string[] {
  return config?.safety?.deny ?? DEFAULT_SAFETY_DENY;
}

/** Hardcoded — plan/spec live in .fapony/ (gitignored = private). */
export function planDir(): string {
  return PLAN_DIR;
}

/** Hardcoded — plan/spec live in .fapony/ (gitignored = private). */
export function specDir(): string {
  return SPEC_DIR;
}

export function doneDir(config?: Config): string {
  return config?.paths?.doneDir ?? DEFAULT_DONE_DIR;
}

export function memoryDir(config?: Config): string {
  return config?.paths?.memDir ?? DEFAULT_MEM_DIR;
}

export function evidenceFile(config?: Config): string {
  return config?.paths?.evidenceFile ?? DEFAULT_EVIDENCE_FILE;
}
