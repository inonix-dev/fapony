// test/hook/helpers.ts — shared helpers for hook tests.
//
// Re-exports generic helpers from test/helpers.ts and adds what only hook
// tests need: withStateDir, padFile, editFixture, writeTempMemRow, writeTranscript.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export {
  captureErrors,
  silentErrors,
  withTempHome,
  withTempRepo,
  writeJson,
} from "../helpers.js";

/**
 * Run fn with an isolated FAPONY_STATE_DIR. Creates a temp dir, sets the env
 * var, runs fn(dir), then restores the env and cleans up.
 */
export function withStateDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-state-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    fn(dir);
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeTempMemRow(dir: string, ts: string): void {
  mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
  const row = JSON.stringify({
    ts,
    agent: "t",
    kind: "note",
    text: "test row",
    files: ["README.md"],
  });
  writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${row}\n`);
}

export function writeTranscript(
  dir: string,
  lines: Record<string, unknown>[],
): string {
  const p = join(dir, "transcript.jsonl");
  writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return p;
}
