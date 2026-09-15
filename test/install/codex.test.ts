// test/install/codex.test.ts — Codex install provider

import assert from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cmdInstall,
  cmdInstallCodex,
  INSTALL_ROOT,
} from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  type TestExit,
  testExit,
  withTempHome,
} from "./helpers.js";

function codexEntryToml(): string {
  return `[mcp_servers.fapony]
command = "bun"
args = ["run", "${join(INSTALL_ROOT, "fapony.ts")}", "mcp"]
type = "stdio"
`;
}

export function testInstallCodexNoConfigFails(): void {
  withTempHome((home) => {
    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallCodex(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("Codex config not found"), `got: ${err}`);
    console.log("  ✓ install codex no config → clear error");
  });
}

export function testInstallCodexAppendsEntry(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n');

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.ok(after.includes("[mcp_servers.fapony]"), `got: ${after}`);
    assert.ok(after.includes('model = "gpt-5"'), `got: ${after}`);
    assert.ok(err.includes("added mcp_servers.fapony"), `got: ${err}`);
    console.log("  ✓ install codex existing config → appends entry");
  });
}

export function testInstallCodexAlreadyConfiguredNoOp(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, codexEntryToml());

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("already configured"), `got: ${err}`);
    console.log("  ✓ install codex already configured → no-op");
  });
}

export function testInstallCodexDryRunNoWrite(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n');

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(true, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    console.log("  ✓ install codex dry-run → no write");
  });
}

export function testCmdInstallDispatchesCodex(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n');

    silentErrors(() =>
      cmdInstall(["codex"], { exit: testExit, homedir: () => home }),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.ok(after.includes("[mcp_servers.fapony]"), `got: ${after}`);
    console.log("  ✓ install dispatch routes --platform codex");
  });
}
