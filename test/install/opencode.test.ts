// test/install/opencode.test.ts — OpenCode install provider

import assert from "node:assert";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  claudeSkillsDir,
  cmdInstall,
  cmdInstallOpencode,
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

function opencodeEntry(): Record<string, unknown> {
  return {
    type: "local",
    command: ["bun", "run", "fapony.ts", "mcp"],
  };
}

export function testInstallOpencodeNewFile(): void {
  withTempHome((home) => {
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const targetPath = join(home, ".config", "opencode", "opencode.json");
    assert.ok(existsSync(targetPath), "opencode.json should be created");
    const cfg = JSON.parse(readFileSync(targetPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(
      (cfg.mcp as Record<string, unknown>).fapony,
      opencodeEntry(),
    );
    assert.ok(err.includes("created"), `got: ${err}`);
    console.log("  ✓ install opencode no config → creates opencode.json");
  });
}

export function testInstallOpencodeAlreadyConfiguredNoOp(): void {
  withTempHome((home) => {
    const configDir = join(home, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeJson(configPath, { mcp: { fapony: opencodeEntry() } });

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("already configured"), `got: ${err}`);
    console.log("  ✓ install opencode already configured → no-op");
  });
}

export function testInstallOpencodeAlreadyConfiguredLinksSkills(): void {
  withTempHome((home) => {
    const configDir = join(home, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    writeJson(join(configDir, "opencode.json"), {
      mcp: { fapony: opencodeEntry() },
    });

    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const dir = claudeSkillsDir(() => home);
    for (const name of skillNames()) {
      assert.ok(
        lstatSync(join(dir, name)).isSymbolicLink(),
        `${name} should be symlinked into ~/.claude/skills even when mcp is already configured`,
      );
    }
    console.log("  ✓ install opencode already configured → still links skills");
  });
}

export function testInstallOpencodeDryRunNoWrite(): void {
  withTempHome((home) => {
    const configDir = join(home, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeJson(configPath, {});

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(true, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    assert.ok(err.includes("mcp.fapony"), `got: ${err}`);
    console.log("  ✓ install opencode dry-run → no write");
  });
}

export function testInstallOpencodeParseErrorFails(): void {
  withTempHome((home) => {
    const configDir = join(home, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, "{ not json\n");

    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallOpencode(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("failed to parse"), `got: ${err}`);
    console.log("  ✓ install opencode broken config → clear error");
  });
}

export function testCmdInstallDispatchesOpencode(): void {
  withTempHome((home) => {
    silentErrors(() =>
      cmdInstall(["opencode"], { exit: testExit, homedir: () => home }),
    );
    const targetPath = join(home, ".config", "opencode", "opencode.json");
    const cfg = JSON.parse(readFileSync(targetPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(
      (cfg.mcp as Record<string, unknown>).fapony,
      opencodeEntry(),
    );
    console.log("  ✓ install dispatch routes --platform opencode");
  });
}

export function testInstallOpencodeReadHintPlugin(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-read-hint.ts",
    );
    // Fresh install path.
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(existsSync(pluginPath), "plugin file should be written");
    const src = readFileSync(pluginPath, "utf-8");
    assert.ok(src.includes("readHintFor"), "must import the shared logic");
    assert.ok(
      src.includes("tool.execute.after"),
      "must hook tool.execute.after",
    );
    assert.ok(err.includes("read hint"), `got: ${err}`);

    // Idempotent — and the already-configured early-return path still runs it.
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(pluginPath, "utf-8");
    assert.equal(src, after, "second install must not rewrite the plugin");
  });
  console.log(
    "  ✓ install opencode read hint → plugin written once, both paths",
  );
}

export function testInstallOpencodeReadHintForeignFileUntouched(): void {
  withTempHome((home) => {
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, "fapony-read-hint.ts");
    writeFileSync(pluginPath, "// someone else's plugin\n");
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.equal(
      readFileSync(pluginPath, "utf-8"),
      "// someone else's plugin\n",
      "a foreign file at our name must never be overwritten",
    );
  });
  console.log("  ✓ install opencode read hint → foreign plugin untouched");
}
