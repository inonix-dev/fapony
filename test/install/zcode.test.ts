import { test } from "bun:test";
// test/install/zcode.test.ts — ZCode install provider

import assert from "node:assert";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentsSkillsDir,
  cmdInstall,
  cmdInstallZcode,
  INSTALL_ROOT,
} from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  skillNames,
  type TestExit,
  testExit,
  withTempHome,
  writeJson,
} from "./helpers.js";

function zcodeEntry(): Record<string, unknown> {
  return {
    type: "stdio",
    command: "bun",
    args: ["run", join(INSTALL_ROOT, "fapony.ts"), "mcp"],
  };
}

test("testInstallZcodeNoConfigFails", () => {
  withTempHome((home) => {
    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallZcode(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("ZCode config not found"), `got: ${err}`);
    console.log("  ✓ install zcode no config → clear error");
  });
});

test("testInstallZcodePrimaryPath", () => {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, {
      mcp: {
        servers: { other: { type: "stdio", command: "node", args: ["x.js"] } },
      },
    });

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const servers = (cfg.mcp as Record<string, unknown>).servers as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(servers.fapony, zcodeEntry());
    assert.deepStrictEqual(servers.other, {
      type: "stdio",
      command: "node",
      args: ["x.js"],
    });
    assert.ok(err.includes("added mcp.fapony"), `got: ${err}`);
    console.log(
      "  ✓ install zcode primary path → writes ~/.zcode/cli/config.json",
    );
  });
});

test("testInstallZcodeFallbackPath", () => {
  withTempHome((home) => {
    const agentsDir = join(home, ".agents");
    mkdirSync(agentsDir, { recursive: true });
    const configPath = join(agentsDir, "mcp.json");
    writeJson(configPath, {
      mcpServers: { other: { type: "stdio", command: "node", args: ["x.js"] } },
    });

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const servers = cfg.mcpServers as Record<string, unknown>;
    assert.deepStrictEqual(servers.fapony, zcodeEntry());
    assert.ok(err.includes("fallback path: ~/.agents/mcp.json"), `got: ${err}`);
    console.log("  ✓ install zcode fallback path → writes ~/.agents/mcp.json");
  });
});

test("testInstallZcodeAlreadyConfiguredNoOp", () => {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, { mcp: { servers: { fapony: zcodeEntry() } } });

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("already configured"), `got: ${err}`);
    console.log("  ✓ install zcode already configured → no-op");
  });
});

test("testInstallZcodeAlreadyConfiguredLinksSkills", () => {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    writeJson(join(configDir, "config.json"), {
      mcp: { servers: { fapony: zcodeEntry() } },
    });

    silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const dir = agentsSkillsDir(() => home);
    for (const name of skillNames()) {
      assert.ok(
        lstatSync(join(dir, name)).isSymbolicLink(),
        `${name} should be symlinked into ~/.agents/skills even when mcp is already configured`,
      );
    }
    console.log("  ✓ install zcode already configured → still links skills");
  });
});

test("testInstallZcodeDryRunNoWrite", () => {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, {});

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(true, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    assert.ok(err.includes("mcp.servers.fapony"), `got: ${err}`);
    console.log("  ✓ install zcode dry-run → no write");
  });
});

test("testInstallZcodeLinksSkillsIntoAgentsDir", () => {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    writeJson(join(configDir, "config.json"), {});

    silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const dir = agentsSkillsDir(() => home);
    assert.equal(dir, join(home, ".agents", "skills"));
    const names = skillNames();
    assert.ok(names.length > 0, "repo should ship at least one skill");
    for (const name of names) {
      assert.ok(
        lstatSync(join(dir, name)).isSymbolicLink(),
        `${name} should be symlinked into ~/.agents/skills`,
      );
    }
    console.log("  ✓ install zcode → symlinks skills into ~/.agents/skills");
  });
});

test("testCmdInstallDispatchesZcode", () => {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, {});

    silentErrors(() =>
      cmdInstall(["zcode"], { exit: testExit, homedir: () => home }),
    );
    const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const servers = (cfg.mcp as Record<string, unknown>).servers as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(servers.fapony, zcodeEntry());
    console.log("  ✓ install dispatch routes --platform zcode");
  });
});
