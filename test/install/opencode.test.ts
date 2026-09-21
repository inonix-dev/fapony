// test/install/opencode.test.ts — OpenCode install provider

import assert from "node:assert";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  claudeSkillsDir,
  cmdInstall,
  cmdInstallOpencode,
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

function opencodeEntry(): Record<string, unknown> {
  return {
    type: "local",
    command: ["bun", "run", join(INSTALL_ROOT, "fapony.ts"), "mcp"],
  };
}

/** Regression guard: OpenCode spawns MCP servers with cwd = the open project,
 *  so a relative `fapony.ts` only resolves when cwd is the fapony checkout.
 *  Installs for real and inspects the written command (tests production). */
export function testInstallOpencodeMcpCommandIsAbsolute(): void {
  withTempHome((home) => {
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const cfg = JSON.parse(
      readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf-8"),
    ) as Record<string, unknown>;
    const entry = (cfg.mcp as Record<string, unknown>).fapony as {
      command: string[];
    };
    const script = entry.command[2];
    assert.ok(
      isAbsolute(script),
      `installed MCP command must be absolute, got: ${script}`,
    );
    assert.ok(script.endsWith("fapony.ts"), `got: ${script}`);
    console.log("  ✓ install opencode MCP command → absolute fapony.ts path");
  });
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

export function testInstallOpencodeCommitHintPlugin(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-commit-hint.ts",
    );
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      existsSync(pluginPath),
      "commit hint plugin file should be written",
    );
    const src = readFileSync(pluginPath, "utf-8");
    assert.ok(src.includes("commitHintFor"), "must import the shared logic");
    assert.ok(src.includes('input.tool !== "bash"'), "must hook the bash tool");
    assert.ok(src.includes("output.output"), "must mutate the tool output");
    assert.ok(err.includes("commit hint"), `got: ${err}`);
    console.log("  ✓ install opencode commit hint → plugin written");
  });
}

export function testInstallOpencodeCommitHintIdempotent(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-commit-hint.ts",
    );
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const src = readFileSync(pluginPath, "utf-8");
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(pluginPath, "utf-8");
    assert.equal(src, after, "second install must not rewrite the plugin");
    console.log("  ✓ install opencode commit hint → idempotent");
  });
}

export function testInstallOpencodeCommitHintForeignFileUntouched(): void {
  withTempHome((home) => {
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, "fapony-commit-hint.ts");
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
    console.log("  ✓ install opencode commit hint → foreign plugin untouched");
  });
}

export function testInstallOpencodeCommitHintDryRun(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-commit-hint.ts",
    );
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(true, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      !existsSync(pluginPath),
      "dry-run must not write the commit hint plugin",
    );
    console.log("  ✓ install opencode commit hint → dry-run no write");
  });
}

export function testInstallOpencodeEditHintPlugin(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-edit-hint.ts",
    );
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      existsSync(pluginPath),
      "edit hint plugin file should be written",
    );
    const src = readFileSync(pluginPath, "utf-8");
    assert.ok(src.includes("editHintFor"), "must import the shared logic");
    assert.ok(src.includes('input.tool !== "edit"'), "must hook the edit tool");
    assert.ok(
      src.includes('input.tool !== "write"'),
      "must hook the write tool",
    );
    assert.ok(src.includes("output.output"), "must mutate the tool output");
    assert.ok(err.includes("edit hint"), `got: ${err}`);

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
    "  ✓ install opencode edit hint → plugin written once, both paths",
  );
}

export function testInstallOpencodeEditHintForeignFileUntouched(): void {
  withTempHome((home) => {
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, "fapony-edit-hint.ts");
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
  console.log("  ✓ install opencode edit hint → foreign plugin untouched");
}

export function testInstallOpencodeEditHintDryRun(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-edit-hint.ts",
    );
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(true, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      !existsSync(pluginPath),
      "dry-run must not write the edit hint plugin",
    );
    console.log("  ✓ install opencode edit hint → dry-run no write");
  });
}

export function testInstallOpencodeSessionStartPlugin(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-session-start.ts",
    );
    // Fresh install path.
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(existsSync(pluginPath), "plugin file should be written");
    const src = readFileSync(pluginPath, "utf-8");
    assert.ok(
      src.includes("experimental.chat.system.transform"),
      "must inject via system.transform, the documented channel",
    );
    assert.ok(
      src.includes("sessionStartContext"),
      "must import the shared implementation, no second guard/cap",
    );
    assert.ok(err.includes("session start"), `got: ${err}`);

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
    "  ✓ install opencode session start → plugin written once, both paths",
  );
}

export function testInstallOpencodeSessionStartStaleWarns(): void {
  withTempHome((home) => {
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, "fapony-session-start.ts");
    // Ours (carries the exported plugin name) but an older generation. The
    // installer never overwrites its own file, so it must name it stale rather
    // than report "already installed — no change" (that kept mub2ezhi alive).
    const stale =
      "// fapony session start\nexport const FaponySessionStart = async () => ({});\n";
    writeFileSync(pluginPath, stale);
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.match(err, /stale fapony plugin/, `got: ${err}`);
    assert.match(
      err,
      /delete .*fapony-session-start\.ts/,
      "names the file to delete",
    );
    assert.equal(
      readFileSync(pluginPath, "utf-8"),
      stale,
      "stale plugin must not be silently overwritten",
    );
  });
  console.log(
    "  ✓ install opencode session start → stale plugin warns, untouched",
  );
}

export function testInstallOpencodeSessionStartForeignFileUntouched(): void {
  withTempHome((home) => {
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, "fapony-session-start.ts");
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
  console.log("  ✓ install opencode session start → foreign plugin untouched");
}

export function testInstallOpencodeSessionStartDryRun(): void {
  withTempHome((home) => {
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "fapony-session-start.ts",
    );
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(true, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      !existsSync(pluginPath),
      "dry-run must not write the session start plugin",
    );
    console.log("  ✓ install opencode session start → dry-run no write");
  });
}
