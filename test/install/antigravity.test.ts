import { test } from "bun:test";
// test/install/antigravity.test.ts — Antigravity install provider (skills only; memory moved to fael)

import assert from "node:assert";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cmdInstall, cmdInstallAntigravity } from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  skillNames,
  type TestExit,
  testExit,
  withTempHome,
} from "./helpers.js";

test("testInstallAntigravityNotFoundFails", () => {
  withTempHome((home) => {
    let code: number | null = null;
    const err = captureErrors(() => {
      try {
        cmdInstallAntigravity(false, {
          exit: testExit,
          homedir: () => home,
          checkCmd: () => false,
        });
      } catch (e) {
        code = (e as TestExit).code;
      }
    });
    assert.equal(code, 1);
    assert.ok(err.includes("Antigravity not found"), `got: ${err}`);
  });
});

test("testInstallAntigravityLinksSkillsOnly", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini"), { recursive: true });
    silentErrors(() =>
      cmdInstallAntigravity(false, {
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
  });
});

test("testInstallAntigravityDryRunWritesNothing", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini"), { recursive: true });
    silentErrors(() =>
      cmdInstallAntigravity(true, {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    assert.ok(!existsSync(join(home, ".agents", "skills")));
  });
});

test("testInstallAntigravityAgyOnPathWithoutGeminiDir", () => {
  withTempHome((home) => {
    silentErrors(() =>
      cmdInstallAntigravity(false, {
        exit: testExit,
        homedir: () => home,
        checkCmd: (c) => c === "agy",
      }),
    );
    assert.ok(existsSync(join(home, ".agents", "skills", skillNames()[0])));
  });
});

test("testCmdInstallDispatchesAntigravity", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini"), { recursive: true });
    void silentErrors(() =>
      cmdInstall(["antigravity"], {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    assert.ok(existsSync(join(home, ".agents", "skills", skillNames()[0])));
  });
});

test("testCmdInstallDispatchesAntigravityAlias", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini"), { recursive: true });
    void silentErrors(() =>
      cmdInstall(["agy"], {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    assert.ok(existsSync(join(home, ".agents", "skills", skillNames()[0])));
  });
});
