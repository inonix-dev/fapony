import { test } from "bun:test";
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
  commitHintPluginSource,
  INSTALL_ROOT,
  opencodePluginFiles,
  readHintPluginSource,
  sessionStartPluginSource,
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
test("testInstallOpencodeMcpCommandIsAbsolute", () => {
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
});

test("testInstallOpencodeNewFile", () => {
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
});

test("testInstallOpencodeAlreadyConfiguredNoOp", () => {
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
});

test("testInstallOpencodeAlreadyConfiguredLinksSkills", () => {
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
});

test("testInstallOpencodeDryRunNoWrite", () => {
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
});

test("testInstallOpencodeParseErrorFails", () => {
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
});

test("testCmdInstallDispatchesOpencode", () => {
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
});

test("testInstallOpencodeReadHintPlugin", () => {
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
});

test("testInstallOpencodeReadHintForeignFileUntouched", () => {
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
});

test("testInstallOpencodeCommitHintPlugin", () => {
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
});

test("testInstallOpencodeCommitHintIdempotent", () => {
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
});

test("testInstallOpencodeCommitHintStaleRefreshed", () => {
  withTempHome((home) => {
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, "fapony-commit-hint.ts");
    // An older generation (the pre-recordHintFire shape): carries the plugin
    // name but not the current body. The installers used to answer "already
    // installed — no change" for exactly this, keeping a stale hook live.
    const stale =
      "// fapony commit hint\nexport const FaponyCommitHint = async () => ({});\n";
    writeFileSync(pluginPath, stale);
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.match(err, /commit hint: updated/, `got: ${err}`);
    assert.equal(
      readFileSync(pluginPath, "utf-8"),
      commitHintPluginSource(INSTALL_ROOT),
      "our own stale plugin must be rewritten to the current template",
    );
  });
  console.log(
    "  ✓ install opencode commit hint → stale plugin refreshed in place",
  );
});

test("testInstallOpencodeCommitHintForeignFileUntouched", () => {
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
});

test("testInstallOpencodeCommitHintDryRun", () => {
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
});

test("testInstallOpencodeEditHintPlugin", () => {
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
});

test("testInstallOpencodeEditHintForeignFileUntouched", () => {
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
});

test("testInstallOpencodeEditHintDryRun", () => {
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
});

test("testInstallOpencodeSessionStartPlugin", () => {
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
});

test("testInstallOpencodeSessionStartStaleRefreshed", () => {
  withTempHome((home) => {
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, "fapony-session-start.ts");
    // Ours (carries the exported plugin name) but an older generation. The body
    // is baked at install time, so a pull updates the imported logic but never
    // this file — the installer must rewrite it, or a fixed hook stays
    // unreachable forever (how the pre-hook plugin mub2ezhi would have survived).
    const stale =
      "// fapony session start\nexport const FaponySessionStart = async () => ({});\n";
    writeFileSync(pluginPath, stale);
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.match(err, /session start: updated/, `got: ${err}`);
    assert.equal(
      readFileSync(pluginPath, "utf-8"),
      sessionStartPluginSource(INSTALL_ROOT),
      "our own stale plugin must be rewritten to the current template",
    );
  });
  console.log(
    "  ✓ install opencode session start → stale plugin refreshed in place",
  );
});

test("testInstallOpencodeSessionStartForeignFileUntouched", () => {
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
});

test("testInstallOpencodeSessionStartDryRun", () => {
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
});

// --- post-pull plugin refresh detection (the `fapony update` gate) ---

test("testOpencodePluginFiles", () => {
  withTempHome((home) => {
    assert.deepStrictEqual(
      opencodePluginFiles(() => home),
      [],
      "no plugins dir → nothing installed",
    );
    const pluginsDir = join(home, ".config", "opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    // A foreign plugin must never count — that's what keeps update from
    // touching a file the user owns.
    writeFileSync(join(pluginsDir, "someone-else.ts"), "// x\n");
    assert.deepStrictEqual(
      opencodePluginFiles(() => home),
      [],
      "a foreign plugin is not a fapony install",
    );
    writeFileSync(join(pluginsDir, "fapony-read-hint.ts"), "// ours\n");
    writeFileSync(join(pluginsDir, "fapony-git-autonomy.ts"), "// ours\n");
    assert.deepStrictEqual(
      opencodePluginFiles(() => home).sort(),
      ["fapony-git-autonomy.ts", "fapony-read-hint.ts"],
      "lists every fapony-*.ts plugin, and only those",
    );
  });
  console.log("  ✓ opencodePluginFiles lists fapony plugins, ignores foreign");
});

// --- plugins-only: the `fapony update` refresh must never touch user config ---

test("testInstallOpencodePluginsOnlyLeavesConfigAlone", () => {
  withTempHome((home) => {
    const dir = join(home, ".config", "opencode");
    mkdirSync(join(dir, "plugins"), { recursive: true });
    const configPath = join(dir, "opencode.jsonc");
    // Comments + a custom command: both must survive byte-for-byte.
    const original = `{
  // hand tuned — must survive a refresh
  "theme": "tokyonight",
  "mcp": {
    "fapony": { "type": "local", "command": ["/custom/bin/bun", "run", "/x.ts", "mcp"] }
  }
}
`;
    writeFileSync(configPath, original);
    const readHint = join(dir, "plugins", "fapony-read-hint.ts");
    writeFileSync(
      readHint,
      "// stale\nexport const FaponyReadHint = async () => ({});\n",
    );

    cmdInstallOpencode(false, { homedir: () => home }, { pluginsOnly: true });

    assert.equal(
      readFileSync(configPath, "utf-8"),
      original,
      "plugins-only must never rewrite opencode.json(c)",
    );
    assert.equal(
      readFileSync(readHint, "utf-8"),
      readHintPluginSource(INSTALL_ROOT),
      "plugins-only must still refresh our own stale plugin body",
    );
    assert.ok(
      !existsSync(claudeSkillsDir(() => home)),
      "plugins-only must not link skills either",
    );
  });
  console.log(
    "  ✓ install opencode --plugins-only → config byte-identical, plugin refreshed",
  );
});

test("testInstallOpencodePluginsOnlyCreatesNoConfig", () => {
  withTempHome((home) => {
    // No opencode config at all: plugins-only must not create one.
    cmdInstallOpencode(false, { homedir: () => home }, { pluginsOnly: true });
    assert.ok(
      !existsSync(join(home, ".config", "opencode", "opencode.json")),
      "plugins-only must never create opencode.json",
    );
    assert.ok(
      existsSync(
        join(home, ".config", "opencode", "plugins", "fapony-read-hint.ts"),
      ),
      "plugins-only must still write the plugin bodies",
    );
  });
  console.log(
    "  ✓ install opencode --plugins-only → no config created, plugins written",
  );
});
