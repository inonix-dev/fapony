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
import { join } from "node:path";
import {
  claudeSkillsDir,
  cmdInstall,
  cmdInstallOpencode,
  editHintPluginSource,
  INSTALL_ROOT,
  opencodePluginFiles,
} from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  skillNames,
  testExit,
  withTempHome,
} from "./helpers.js";

const pluginsDir = (home: string): string =>
  join(home, ".config", "opencode", "plugins");

test("testInstallOpencodeLinksSkillsAndNeverWritesConfig", () => {
  withTempHome((home) => {
    silentErrors(() =>
      cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
    );
    const dir = claudeSkillsDir(() => home);
    for (const name of skillNames()) {
      assert.ok(lstatSync(join(dir, name)).isSymbolicLink(), name);
    }
    // MCP moved to fael — no opencode.json write.
    assert.ok(!existsSync(join(home, ".config", "opencode", "opencode.json")));
    assert.ok(existsSync(join(pluginsDir(home), "fapony-edit-hint.ts")));
  });
});

test("testCmdInstallDispatchesOpencode", () => {
  withTempHome((home) => {
    void silentErrors(() =>
      cmdInstall(["opencode"], { exit: testExit, homedir: () => home }),
    );
    assert.ok(existsSync(join(pluginsDir(home), "fapony-edit-hint.ts")));
  });
});

test("testInstallOpencodeRemovesRetiredPlugins", () => {
  withTempHome((home) => {
    const dir = pluginsDir(home);
    mkdirSync(dir, { recursive: true });
    const ours = {
      "fapony-read-hint.ts": "export const FaponyReadHint = 1;\n",
      "fapony-commit-hint.ts": "export const FaponyCommitHint = 1;\n",
      "fapony-session-start.ts": "export const FaponySessionStart = 1;\n",
    };
    for (const [f, body] of Object.entries(ours)) {
      writeFileSync(join(dir, f), body);
    }
    // Same file name, not ours — never touched.
    writeFileSync(join(dir, "fapony-commit-hint.ts"), "// my own plugin\n");

    silentErrors(() =>
      cmdInstallOpencode(true, { homedir: () => home }, { pluginsOnly: true }),
    );
    assert.ok(existsSync(join(dir, "fapony-read-hint.ts")), "dry run keeps");

    const err = captureErrors(() =>
      cmdInstallOpencode(false, { homedir: () => home }, { pluginsOnly: true }),
    );
    assert.ok(!existsSync(join(dir, "fapony-read-hint.ts")));
    assert.ok(!existsSync(join(dir, "fapony-session-start.ts")));
    assert.equal(
      readFileSync(join(dir, "fapony-commit-hint.ts"), "utf-8"),
      "// my own plugin\n",
    );
    assert.ok(err.includes("removed"), err);
  });
});

test("testInstallOpencodePluginsOnlySkipsSkills", () => {
  withTempHome((home) => {
    silentErrors(() =>
      cmdInstallOpencode(false, { homedir: () => home }, { pluginsOnly: true }),
    );
    assert.equal(
      readFileSync(join(pluginsDir(home), "fapony-edit-hint.ts"), "utf-8"),
      editHintPluginSource(INSTALL_ROOT),
    );
    assert.ok(!existsSync(claudeSkillsDir(() => home)));
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
