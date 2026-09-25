import { test } from "bun:test";
// test/install/zcode.test.ts — ZCode install provider (skills only; memory moved to fael)

import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cmdInstall, cmdInstallZcode } from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  skillNames,
  type TestExit,
  testExit,
  withTempHome,
} from "./helpers.js";

/** join + mkdir -p of the parent — returns the file path. */
function mkdir(...parts: string[]): string {
  const p = join(...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

test("testInstallZCodeNotFoundFails", () => {
  withTempHome((home) => {
    let code: number | null = null;
    const err = captureErrors(() => {
      try {
        cmdInstallZcode(false, {
          exit: testExit,
          homedir: () => home,
          checkCmd: () => false,
        });
      } catch (e) {
        code = (e as TestExit).code;
      }
    });
    assert.equal(code, 1);
    assert.ok(err.includes("ZCode config not found"), `got: ${err}`);
  });
});

test("testInstallZCodeLinksSkillsOnly", () => {
  withTempHome((home) => {
    writeFileSync(mkdir(home, ".zcode", "cli", "config.json"), "{}\n");
    const before = readFileSync(
      join(home, ".zcode", "cli", "config.json"),
      "utf-8",
    );
    silentErrors(() =>
      cmdInstallZcode(false, {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    for (const s of skillNames()) {
      assert.ok(
        existsSync(join(home, ".agents", "skills", s)),
        `skill ${s} linked`,
      );
    }
    assert.equal(
      readFileSync(join(home, ".zcode", "cli", "config.json"), "utf-8"),
      before,
      "client config must stay untouched",
    );
  });
});

test("testInstallZCodeDryRunWritesNothing", () => {
  withTempHome((home) => {
    writeFileSync(mkdir(home, ".zcode", "cli", "config.json"), "{}\n");
    silentErrors(() =>
      cmdInstallZcode(true, {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    assert.ok(!existsSync(join(home, ".agents", "skills")));
  });
});

test("testInstallZcodeFallbackConfigCounts", () => {
  withTempHome((home) => {
    writeFileSync(mkdir(home, ".agents", "mcp.json"), "{}\n");
    silentErrors(() =>
      cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
    );
    assert.ok(existsSync(join(home, ".agents", "skills", skillNames()[0])));
  });
});

test("testCmdInstallDispatchesZCode", () => {
  withTempHome((home) => {
    writeFileSync(mkdir(home, ".zcode", "cli", "config.json"), "{}\n");
    void silentErrors(() =>
      cmdInstall(["zcode"], {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    assert.ok(existsSync(join(home, ".agents", "skills", skillNames()[0])));
  });
});
