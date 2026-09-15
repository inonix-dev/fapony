// test/install/helpers.ts — shared helpers for install tests.
//
// Re-exports the generic helpers from test/helpers.ts (same module boundary as
// test/mcp/helpers.ts) and adds what only install tests need: the `exit` seam
// (TestExit/testExit) and the list of skill dirs shipped in skill/.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { INSTALL_ROOT } from "../../src/install.js";

export {
  captureErrors,
  silentErrors,
  withTempHome,
  writeJson,
} from "../helpers.js";

/** Thrown by the injected `exit` seam so a test can assert the exit code. */
export class TestExit extends Error {
  code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

export function testExit(code: number): never {
  throw new TestExit(code);
}

/** Names of the skill dirs this repo ships (sorted) — what install must link. */
export function skillNames(): string[] {
  return readdirSync(join(INSTALL_ROOT, "skill"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}
