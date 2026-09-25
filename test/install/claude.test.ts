import { test } from "bun:test";
// test/install/claude.test.ts — Claude Code install provider

import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdInstall, cmdInstallClaude } from "../../src/install.js";
import { captureErrors, silentErrors, testExit } from "./helpers.js";

type Group = { matcher?: string; hooks: { command: string }[] };
type Settings = { hooks: Record<string, Group[]> };

function homeWith(settings?: unknown): string {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  if (settings !== undefined) {
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify(settings),
    );
  }
  return home;
}

const readSettings = (home: string): Settings =>
  JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8"));

const install = (home: string, dryRun = false): string =>
  captureErrors(() =>
    cmdInstallClaude(dryRun, { exit: testExit, homedir: () => home }),
  );

test("testInstallClaudeWiresEditAndMvGuardOnce", () => {
  // A foreign PreToolUse entry must survive — Claude Code runs every entry.
  const home = homeWith({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "/tmp/theirs" }],
        },
      ],
    },
  });
  install(home);
  install(home);

  const s = readSettings(home);
  const pre = s.hooks.PreToolUse;
  assert.equal(pre.length, 3, "installing twice must not duplicate");
  assert.ok(JSON.stringify(pre[0]).includes("/tmp/theirs"));
  assert.ok(
    JSON.stringify(pre.find((e) => e.matcher === "Edit")).includes(
      "hook-edit-hint",
    ),
  );
  assert.ok(
    pre.some(
      (e) =>
        e.matcher === "Bash" && JSON.stringify(e).includes("hook-mv-guard"),
    ),
  );
  // Memory hooks belong to fael now.
  assert.equal(s.hooks.Stop, undefined);
  assert.equal(s.hooks.SessionStart, undefined);
  assert.ok(!pre.some((e) => e.matcher === "Read"));
});

test("testInstallClaudeRemovesRetiredFaponyHooks", () => {
  const cmd = (sub: string) => ({
    type: "command",
    command: `bun /x/fapony.ts ${sub}`,
  });
  const home = homeWith({
    hooks: {
      Stop: [
        { hooks: [cmd("hook-stop")] },
        { hooks: [{ type: "command", command: "fael hook stop" }] },
      ],
      SessionStart: [{ hooks: [cmd("hook-session-start")] }],
      PreToolUse: [
        { matcher: "Read", hooks: [cmd("hook-read-hint")] },
        { matcher: "Edit", hooks: [cmd("hook-edit-hint")] },
      ],
    },
  });

  // Dry run reports but writes nothing.
  install(home, true);
  assert.equal(readSettings(home).hooks.Stop.length, 2);

  install(home);
  const s = readSettings(home);
  assert.deepStrictEqual(
    s.hooks.Stop.map((g) => g.hooks[0].command),
    ["fael hook stop"],
    "fapony's Stop goes, fael's stays",
  );
  assert.equal(s.hooks.SessionStart, undefined);
  assert.deepStrictEqual(
    s.hooks.PreToolUse.map((g) => g.matcher),
    ["Edit", "Bash"],
  );
});

test("testCmdInstallDispatchesClaude", async () => {
  const home = homeWith();
  await silentErrors(() =>
    cmdInstall(["claude"], { exit: testExit, homedir: () => home }),
  );
  assert.ok(
    JSON.stringify(readSettings(home)).includes("hook-edit-hint"),
    "--platform claude routes to the claude installer",
  );
});
