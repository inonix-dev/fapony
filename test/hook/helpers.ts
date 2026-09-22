// test/hook/helpers.ts — shared helpers for hook tests.
//
// Re-exports generic helpers from test/helpers.ts and adds what only hook
// tests need: withStateDir, padFile, editFixture, writeTempMemRow, writeTranscript.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READ_HINT_MIN_BYTES } from "../../src/hook.js";

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

/** Isolated FAPONY_STATE_DIR for the edit-track log; restored after. */
export function withEditState(fn: () => void): void {
  const state = mkdtempSync(join(tmpdir(), "fapony-eh-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = state;
  try {
    fn();
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(state, { recursive: true, force: true });
  }
}

/** > 2x threshold, so the fixture stays valid if the constant moves. */
const PAD = Math.ceil(READ_HINT_MIN_BYTES / 20) * 20 + 40;

export function padFile(dir: string, name: string): string {
  const p = join(dir, name);
  const body = Array.from(
    { length: PAD },
    (_, i) => `const pad${i} = ${i}; // padding`,
  ).join("\n");
  writeFileSync(p, `export const entry = () => {\n${body}\n};\n`);
  return p;
}

export function editFixture(dir: string): {
  lib: string;
  top: string;
  lone: string;
} {
  const lib = join(dir, "lib.ts");
  writeFileSync(lib, "export const value = 1;\n");
  writeFileSync(
    join(dir, "mid.ts"),
    'import { value } from "./lib.js";\nimport { top } from "./top.js";\nconsole.log(value, top);\n',
  );
  writeFileSync(
    join(dir, "top.ts"),
    'import { value } from "./lib.js";\nexport const top = value + 1;\n',
  );
  const lone = join(dir, "lone.ts");
  writeFileSync(lone, "export const alone = 1;\n");
  return { lib, top: join(dir, "top.ts"), lone };
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
