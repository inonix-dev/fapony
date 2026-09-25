import { test } from "bun:test";
// test/install/codex.test.ts — Codex install provider (skills only; memory moved to fael)

import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cmdInstall, cmdInstallCodex } from "../../src/install.js";
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

test("testInstallCodexNotFoundFails", () => {
  withTempHome((home) => {
    let code: number | null = null;
    const err = captureErrors(() => {
      try {
        cmdInstallCodex(false, {
          exit: testExit,
          homedir: () => home,
          checkCmd: () => false,
        });
      } catch (e) {
        code = (e as TestExit).code;
      }
    });
    assert.equal(code, 1);
    assert.ok(err.includes("Codex config not found"), `got: ${err}`);
  });
});

test("testInstallCodexLinksSkillsOnly", () => {
  withTempHome((home) => {
    writeFileSync(mkdir(home, ".codex", "config.toml"), 'model = "x"\n');
    const before = readFileSync(join(home, ".codex", "config.toml"), "utf-8");
    silentErrors(() =>
      cmdInstallCodex(false, {
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
      readFileSync(join(home, ".codex", "config.toml"), "utf-8"),
      before,
      "client config must stay untouched",
    );
  });
});

test("testInstallCodexDryRunWritesNothing", () => {
  withTempHome((home) => {
    writeFileSync(mkdir(home, ".codex", "config.toml"), 'model = "x"\n');
    silentErrors(() =>
      cmdInstallCodex(true, {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    assert.ok(!existsSync(join(home, ".agents", "skills")));
  });
});

test("testCmdInstallDispatchesCodex", () => {
  withTempHome((home) => {
    writeFileSync(mkdir(home, ".codex", "config.toml"), 'model = "x"\n');
    void silentErrors(() =>
      cmdInstall(["codex"], {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    assert.ok(existsSync(join(home, ".agents", "skills", skillNames()[0])));
  });
});
