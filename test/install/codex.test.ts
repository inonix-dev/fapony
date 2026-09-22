import { test } from "bun:test";
// test/install/codex.test.ts — Codex install provider

import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cmdInstall,
  cmdInstallCodex,
  findCodexHooksJson,
  INSTALL_ROOT,
} from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  skillNames,
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

function hookCommand(): string {
  return `bun ${join(INSTALL_ROOT, "fapony.ts")} hook-stop`;
}

function sessionStartCommand(): string {
  return `bun ${join(INSTALL_ROOT, "fapony.ts")} hook-session-start`;
}

// --- MCP config tests ---

test("testInstallCodexNoConfigFails", () => {
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
});

test("testInstallCodexAppendsEntry", () => {
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
});

test("testInstallCodexAlreadyConfiguredNoOp", () => {
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
});

test("testInstallCodexDryRunNoWrite", () => {
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
});

test("testCmdInstallDispatchesCodex", () => {
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
});

// --- Stop hook tests ---

test("testInstallCodexCreatesHooksJson", () => {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());

    silentErrors(() =>
      cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
    );
    const hooksPath = findCodexHooksJson(() => home);
    assert.ok(hooksPath, "hooks.json should exist");
    const hooks = JSON.parse(readFileSync(hooksPath!, "utf-8")) as Record<
      string,
      unknown
    >;
    const stop = (hooks.hooks as Record<string, unknown>)?.Stop as Array<
      Record<string, unknown>
    >;
    assert.ok(Array.isArray(stop), "Stop must be an array");
    assert.equal(stop.length, 1, "exactly one Stop entry");
    const entry = stop[0] as Record<string, unknown>;
    const hookHandlers = entry.hooks as Array<Record<string, unknown>>;
    assert.equal(hookHandlers.length, 1);
    assert.equal(hookHandlers[0].type, "command");
    assert.equal(hookHandlers[0].command, hookCommand());
    const ss = (hooks.hooks as Record<string, unknown>)?.SessionStart as Array<
      Record<string, unknown>
    >;
    assert.ok(Array.isArray(ss), "SessionStart must be an array");
    assert.equal(ss.length, 1, "exactly one SessionStart entry");
    const ssHandlers = (ss[0] as Record<string, unknown>).hooks as Array<
      Record<string, unknown>
    >;
    assert.equal(ssHandlers.length, 1);
    assert.equal(ssHandlers[0].type, "command");
    assert.equal(ssHandlers[0].command, sessionStartCommand());
    console.log(
      "  ✓ install codex creates hooks.json with Stop + SessionStart hooks",
    );
  });
});

test("testInstallCodexHooksMergePreservesForeign", () => {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());

    // Pre-existing hooks.json with a foreign Stop entry and a SessionStart group
    const existing = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "foreign-hook" }] }],
        SessionStart: [
          { hooks: [{ type: "command", command: "session-start.py" }] },
        ],
      },
    };
    writeFileSync(
      join(configDir, "hooks.json"),
      JSON.stringify(existing, null, 2),
    );

    silentErrors(() =>
      cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
    );
    const hooks = JSON.parse(
      readFileSync(join(configDir, "hooks.json"), "utf-8"),
    ) as Record<string, unknown>;
    const stop = (hooks.hooks as Record<string, unknown>)?.Stop as Array<
      Record<string, unknown>
    >;
    assert.equal(stop.length, 2, "foreign + fapony Stop entries");
    assert.ok(
      JSON.stringify(stop[0]).includes("foreign-hook"),
      "foreign entry preserved",
    );
    assert.ok(
      JSON.stringify(stop[1]).includes("hook-stop"),
      "fapony entry appended",
    );
    // SessionStart: foreign entry preserved, fapony entry appended
    const ss = (hooks.hooks as Record<string, unknown>)?.SessionStart as Array<
      Record<string, unknown>
    >;
    assert.equal(ss.length, 2, "foreign + fapony SessionStart entries");
    assert.ok(
      JSON.stringify(ss[0]).includes("session-start.py"),
      "foreign entry preserved",
    );
    assert.ok(
      JSON.stringify(ss[1]).includes("hook-session-start"),
      "fapony entry appended",
    );
    console.log("  ✓ install codex hooks.json merge preserves foreign entries");
  });
});

test("testInstallCodexHooksAlreadyConfiguredNoOp", () => {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());

    const existing = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: hookCommand() }] }],
        SessionStart: [
          { hooks: [{ type: "command", command: sessionStartCommand() }] },
        ],
      },
    };
    writeFileSync(
      join(configDir, "hooks.json"),
      JSON.stringify(existing, null, 2),
    );

    const before = readFileSync(join(configDir, "hooks.json"), "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(join(configDir, "hooks.json"), "utf-8");
    assert.equal(before, after, "hooks.json must not change");
    assert.ok(err.includes("already configured"), `got: ${err}`);
    console.log("  ✓ install codex hooks.json already configured → no-op");
  });
});

test("testInstallCodexSessionStartUpgradeAppends", () => {
  // Every existing install has Stop but no SessionStart — the upgrade path
  // must append the new group and leave Stop byte-identical.
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());

    const stopEntry = {
      hooks: [{ type: "command", command: hookCommand() }],
    };
    writeFileSync(
      join(configDir, "hooks.json"),
      JSON.stringify({ hooks: { Stop: [stopEntry] } }, null, 2),
    );

    silentErrors(() =>
      cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
    );
    const hooks = JSON.parse(
      readFileSync(join(configDir, "hooks.json"), "utf-8"),
    ) as Record<string, unknown>;
    const stop = (hooks.hooks as Record<string, unknown>)?.Stop as unknown[];
    assert.deepEqual(stop, [stopEntry], "Stop group must be untouched");
    const ss = (hooks.hooks as Record<string, unknown>)?.SessionStart as Array<
      Record<string, unknown>
    >;
    assert.ok(Array.isArray(ss) && ss.length === 1, "SessionStart appended");
    const handlers = (ss[0] as Record<string, unknown>).hooks as Array<
      Record<string, unknown>
    >;
    assert.equal(handlers[0].command, sessionStartCommand());
    console.log("  ✓ install codex Stop-only install → SessionStart appended");
  });
});

test("testInstallCodexHooksMalformedSkipsGracefully", () => {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());
    // Malformed JSON
    writeFileSync(join(configDir, "hooks.json"), "not json {{{");

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      err.includes("malformed") || err.includes("skipping"),
      `got: ${err}`,
    );
    console.log("  ✓ install codex hooks.json malformed → skip gracefully");
  });
});

test("testInstallCodexDryRunHooksNoWrite", () => {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());

    silentErrors(() =>
      cmdInstallCodex(true, { exit: testExit, homedir: () => home }),
    );
    assert.ok(
      !existsSync(join(configDir, "hooks.json")),
      "hooks.json must not exist in dry-run",
    );
    console.log("  ✓ install codex dry-run → no hooks.json written");
  });
});

// --- Skill linking tests ---

test("testInstallCodexLinksSkills", () => {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());

    silentErrors(() =>
      cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
    );
    const skillsDir = join(home, ".agents", "skills");
    for (const name of skillNames()) {
      const link = join(skillsDir, name);
      assert.ok(existsSync(link), `skill ${name} should be linked`);
    }
    console.log("  ✓ install codex links skills to ~/.agents/skills");
  });
});

test("testInstallCodexSkillsConflictUntouched", () => {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.toml"), codexEntryToml());

    // Create a conflicting skill dir (not a symlink)
    const skillsDir = join(home, ".agents", "skills");
    const names = skillNames();
    if (names.length > 0) {
      mkdirSync(join(skillsDir, names[0]), { recursive: true });
      writeFileSync(join(skillsDir, names[0], "SKILL.md"), "user content");
    }

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
      ),
    );
    if (names.length > 0) {
      assert.ok(
        err.includes(names[0]) && err.includes("not overwriting"),
        `conflict reported: ${err}`,
      );
      // User content preserved
      const content = readFileSync(
        join(skillsDir, names[0], "SKILL.md"),
        "utf-8",
      );
      assert.equal(content, "user content", "conflict must not overwrite");
    }
    console.log("  ✓ install codex skill conflict → preserve user content");
  });
});

test("testInstallCodexFindHooksJson", () => {
  withTempHome((home) => {
    assert.equal(
      findCodexHooksJson(() => home),
      null,
      "no file → null",
    );
    const dir = join(home, ".codex");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "hooks.json");
    writeFileSync(p, "{}");
    assert.equal(
      findCodexHooksJson(() => home),
      p,
      "file exists → path",
    );
    console.log("  ✓ findCodexHooksJson");
  });
});
