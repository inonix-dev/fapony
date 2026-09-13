import {
  DEFAULT_DONE_DIR,
  DEFAULT_EVIDENCE_FILE,
  DEFAULT_MEMORY_ENTRY,
  DEFAULT_PLAN_DIR,
  DEFAULT_SAFETY_DENY,
  DEFAULT_SPEC_DIR,
} from "./defaults.js";
import type { Config } from "./types.js";

export function safetyDeny(config?: Config): string[] {
  return config?.safety?.deny ?? DEFAULT_SAFETY_DENY;
}

export function planDir(config?: Config): string {
  return config?.paths?.planDir ?? DEFAULT_PLAN_DIR;
}

export function specDir(config?: Config): string {
  return config?.paths?.specDir ?? DEFAULT_SPEC_DIR;
}

export function doneDir(config?: Config): string {
  return config?.paths?.doneDir ?? DEFAULT_DONE_DIR;
}

export function memoryEntry(config?: Config): string {
  return config?.paths?.memoryEntry ?? DEFAULT_MEMORY_ENTRY;
}

export function evidenceFile(config?: Config): string {
  return config?.paths?.evidenceFile ?? DEFAULT_EVIDENCE_FILE;
}
