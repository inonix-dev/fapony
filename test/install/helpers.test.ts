import { test } from "bun:test";
// test/install/helpers.test.ts — install module sanity checks

import assert from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INSTALL_ROOT } from "../../src/install.js";

test("testInstallRootIsRepoRoot", () => {
  assert.ok(
    existsSync(join(INSTALL_ROOT, "package.json")),
    `INSTALL_ROOT must be the repo root, got: ${INSTALL_ROOT}`,
  );
  assert.ok(
    existsSync(join(INSTALL_ROOT, "fapony.ts")),
    `INSTALL_ROOT must contain fapony.ts, got: ${INSTALL_ROOT}`,
  );
  console.log("  ✓ install INSTALL_ROOT is repo root");
});
