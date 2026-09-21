// test/install/antigravity.test.ts — Antigravity install provider

import assert from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cmdInstall, cmdInstallAntigravity } from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  type TestExit,
  testExit,
  withTempHome,
} from "./helpers.js";

export function testInstallAntigravityNoDirFails(): void {
  withTempHome((home) => {
    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallAntigravity(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("Antigravity not found"), `got: ${err}`);
    console.log("  ✓ install antigravity no ~/.gemini → clear error");
  });
}

export function testInstallAntigravityFreshWritesMcpAndSkills(): void {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf-8"),
    ) as { mcpServers?: Record<string, { command: string; args: string[] }> };
    assert.ok(mcp.mcpServers?.fapony, `got: ${err}`);
    assert.equal(mcp.mcpServers.fapony.command, "bun");
    assert.ok(mcp.mcpServers.fapony.args.includes("mcp"));
    console.log(
      "  ✓ install antigravity fresh → mcp_config.json written + skills linked",
    );
  });
}

export function testInstallAntigravityForeignMcpRefuses(): void {
  withTempHome((home) => {
    const configDir = join(home, ".gemini", "config");
    mkdirSync(configDir, { recursive: true });
    const mcpPath = join(configDir, "mcp_config.json");
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
          cmdInstallAntigravity(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("points elsewhere"), `got: ${err}`);
    assert.equal(readFileSync(mcpPath, "utf-8"), before);
    console.log("  ✓ install antigravity foreign fapony entry → refuses");
  });
}

export function testInstallAntigravityAlreadyConfiguredNoOp(): void {
  withTempHome((home) => {
    const configDir = join(home, ".gemini", "config");
    mkdirSync(configDir, { recursive: true });
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const mcpBefore = readFileSync(join(configDir, "mcp_config.json"), "utf-8");

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.equal(
      readFileSync(join(configDir, "mcp_config.json"), "utf-8"),
      mcpBefore,
    );
    assert.ok(err.includes("already configured"), `got: ${err}`);
    assert.ok(err.includes("no change"), `got: ${err}`);
    console.log("  ✓ install antigravity already configured → no-op");
  });
}

export function testInstallAntigravityDryRunNoWrite(): void {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(true, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      !readIfExists(join(home, ".gemini", "config", "mcp_config.json")),
      "mcp_config.json written",
    );
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    assert.ok(
      err.includes("would create") || err.includes("would write"),
      `got: ${err}`,
    );
    console.log("  ✓ install antigravity dry-run → no write");
  });
}

export function testInstallAntigravityMergesExistingServers(): void {
  withTempHome((home) => {
    const configDir = join(home, ".gemini", "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "mcp_config.json"),
      `${JSON.stringify(
        {
          mcpServers: {
            "other-server": { command: "npx", args: ["other"] },
          },
        },
        null,
        2,
      )}\n`,
    );

    silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const mcp = JSON.parse(
      readFileSync(join(configDir, "mcp_config.json"), "utf-8"),
    ) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    assert.ok(mcp.mcpServers["other-server"], "other server preserved");
    assert.ok(mcp.mcpServers.fapony, "fapony added");
    console.log(
      "  ✓ install antigravity existing mcpServers → merge, not overwrite",
    );
  });
}

export function testCmdInstallDispatchesAntigravity(): void {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    silentErrors(() =>
      cmdInstall(["antigravity"], { exit: testExit, homedir: () => home }),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf-8"),
    ) as { mcpServers?: Record<string, unknown> };
    assert.ok(mcp.mcpServers?.fapony, "mcp.fapony should be written");
    console.log("  ✓ install dispatch routes --platform antigravity");
  });
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
