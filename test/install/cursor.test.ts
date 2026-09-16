// test/install/cursor.test.ts — Cursor install provider

import assert from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cmdInstall,
  cmdInstallCursor,
  INSTALL_ROOT,
} from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  type TestExit,
  testExit,
  withTempHome,
} from "./helpers.js";

function hookCommand(): string {
  return `bun ${join(INSTALL_ROOT, "fapony.ts")} hook-stop`;
}

export function testInstallCursorNoDirFails(): void {
  withTempHome((home) => {
    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallCursor(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("Cursor not found"), `got: ${err}`);
    console.log("  ✓ install cursor no ~/.cursor → clear error");
  });
}

export function testInstallCursorFreshWritesMcpAndHooks(): void {
  withTempHome((home) => {
    mkdirSync(join(home, ".cursor"));
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCursor(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".cursor", "mcp.json"), "utf-8"),
    ) as { mcpServers?: Record<string, { command: string; args: string[] }> };
    assert.ok(mcp.mcpServers?.fapony, `got: ${err}`);
    assert.equal(mcp.mcpServers.fapony.command, "bun");
    assert.ok(mcp.mcpServers.fapony.args.includes("mcp"));
    const hooks = JSON.parse(
      readFileSync(join(home, ".cursor", "hooks.json"), "utf-8"),
    ) as {
      version: number;
      hooks: { stop: Array<{ command: string }> };
    };
    assert.equal(hooks.version, 1);
    assert.ok(
      hooks.hooks.stop.some((h) => h.command === hookCommand()),
      `got: ${JSON.stringify(hooks)}`,
    );
    console.log("  ✓ install cursor fresh → mcp.json + hooks.json written");
  });
}

export function testInstallCursorMergesStopHookKeepsOthers(): void {
  withTempHome((home) => {
    const dir = join(home, ".cursor");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "hooks.json"),
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            stop: [{ command: "code-review-graph hook stop" }],
            preToolUse: [{ command: "code-review-graph hook pre" }],
          },
        },
        null,
        2,
      )}\n`,
    );

    silentErrors(() =>
      captureErrors(() =>
        cmdInstallCursor(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const hooks = JSON.parse(
      readFileSync(join(dir, "hooks.json"), "utf-8"),
    ) as {
      version: number;
      hooks: { stop: Array<{ command: string }>; preToolUse: unknown[] };
    };
    assert.equal(hooks.version, 1);
    assert.equal(
      hooks.hooks.stop.length,
      2,
      "existing stop entry must survive the merge",
    );
    assert.ok(
      hooks.hooks.stop.some((h) => h.command.includes("code-review-graph")),
    );
    assert.ok(hooks.hooks.stop.some((h) => h.command === hookCommand()));
    assert.equal(hooks.hooks.preToolUse.length, 1, "other events untouched");
    console.log("  ✓ install cursor existing hooks → merge, not overwrite");
  });
}

export function testInstallCursorForeignMcpRefuses(): void {
  withTempHome((home) => {
    const dir = join(home, ".cursor");
    mkdirSync(dir);
    const mcpPath = join(dir, "mcp.json");
    writeFileSync(
      mcpPath,
      `${JSON.stringify(
        { mcpServers: { fapony: { command: "npx", args: ["someone-else"] } } },
        null,
        2,
      )}\n`,
    );
    const before = readFileSync(mcpPath, "utf-8");

    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallCursor(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("points elsewhere"), `got: ${err}`);
    assert.equal(readFileSync(mcpPath, "utf-8"), before);
    console.log("  ✓ install cursor foreign fapony entry → refuses");
  });
}

export function testInstallCursorAlreadyConfiguredNoOp(): void {
  withTempHome((home) => {
    const dir = join(home, ".cursor");
    mkdirSync(dir);
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallCursor(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const mcpBefore = readFileSync(join(dir, "mcp.json"), "utf-8");
    const hooksBefore = readFileSync(join(dir, "hooks.json"), "utf-8");

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCursor(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.equal(readFileSync(join(dir, "mcp.json"), "utf-8"), mcpBefore);
    assert.equal(readFileSync(join(dir, "hooks.json"), "utf-8"), hooksBefore);
    assert.ok(err.includes("already configured"), `got: ${err}`);
    assert.ok(err.includes("no change"), `got: ${err}`);
    console.log("  ✓ install cursor already configured → no-op");
  });
}

export function testInstallCursorDryRunNoWrite(): void {
  withTempHome((home) => {
    mkdirSync(join(home, ".cursor"));
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCursor(true, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      !readIfExists(join(home, ".cursor", "mcp.json")),
      "mcp.json written",
    );
    assert.ok(
      !readIfExists(join(home, ".cursor", "hooks.json")),
      "hooks.json written",
    );
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    assert.ok(err.includes("would write"), `got: ${err}`);
    console.log("  ✓ install cursor dry-run → no write");
  });
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

export function testCmdInstallDispatchesCursor(): void {
  withTempHome((home) => {
    mkdirSync(join(home, ".cursor"));
    silentErrors(() =>
      cmdInstall(["cursor"], { exit: testExit, homedir: () => home }),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".cursor", "mcp.json"), "utf-8"),
    ) as { mcpServers?: Record<string, unknown> };
    assert.ok(mcp.mcpServers?.fapony, "mcp.fapony should be written");
    console.log("  ✓ install dispatch routes --platform cursor");
  });
}
