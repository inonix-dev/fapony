import { test } from "bun:test";
// test/install/antigravity.test.ts — Antigravity install provider

import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cmdInstall, cmdInstallAntigravity } from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  skillNames,
  type TestExit,
  testExit,
  withTempHome,
} from "./helpers.js";

test("testInstallAntigravityNoDirFails", () => {
  withTempHome((home) => {
    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallAntigravity(false, {
            exit: testExit,
            homedir: () => home,
            checkCmd: () => false,
          });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("Antigravity not found"), `got: ${err}`);
    console.log("  ✓ install antigravity no ~/.gemini → clear error");
  });
});

test("testInstallAntigravityFreshWritesMcpAndSkills", () => {
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
});

test("testInstallAntigravityForeignMcpRefuses", () => {
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
});

test("testInstallAntigravityAlreadyConfiguredNoOp", () => {
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
});

test("testInstallAntigravityDryRunNoWrite", () => {
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
    for (const name of skillNames()) {
      assert.ok(
        !existsSync(join(home, ".agents", "skills", name)),
        `skill ${name} must not be linked in dry-run`,
      );
    }
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    assert.ok(
      err.includes("would create") || err.includes("would write"),
      `got: ${err}`,
    );
    console.log("  ✓ install antigravity dry-run → no write, no links");
  });
});

test("testInstallAntigravityMergesExistingServers", () => {
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
});

test("testCmdInstallDispatchesAntigravity", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    silentErrors(() =>
      cmdInstall(["antigravity"], {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf-8"),
    ) as { mcpServers?: Record<string, unknown> };
    assert.ok(mcp.mcpServers?.fapony, "mcp.fapony should be written");
    console.log("  ✓ install dispatch routes --platform antigravity");
  });
});

test("testCmdInstallDispatchesAgyAlias", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    silentErrors(() =>
      cmdInstall(["agy"], {
        exit: testExit,
        homedir: () => home,
        checkCmd: () => false,
      }),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf-8"),
    ) as { mcpServers?: Record<string, unknown> };
    assert.ok(mcp.mcpServers?.fapony, "mcp.fapony should be written");
    console.log("  ✓ install dispatch routes --platform agy alias");
  });
});

test("testInstallAntigravityLinksSkills", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const skillsDir = join(home, ".agents", "skills");
    const names = skillNames();
    assert.ok(names.length > 0, "repo should ship at least one skill");
    for (const name of names) {
      assert.ok(
        existsSync(join(skillsDir, name)),
        `skill ${name} should be linked`,
      );
    }
    console.log("  ✓ install antigravity links all skills → ~/.agents/skills");
  });
});

test("testInstallAntigravitySkillsConflictUntouched", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });

    // Plant a conflicting skill dir (not a symlink) — a user's own skill.
    const skillsDir = join(home, ".agents", "skills");
    const names = skillNames();
    assert.ok(names.length > 0, "repo should ship at least one skill");
    const victim = names[0];
    mkdirSync(join(skillsDir, victim), { recursive: true });
    writeFileSync(join(skillsDir, victim, "SKILL.md"), "user content");

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      err.includes(victim) && err.includes("not overwriting"),
      `conflict reported: ${err}`,
    );
    assert.equal(
      readFileSync(join(skillsDir, victim, "SKILL.md"), "utf-8"),
      "user content",
      "conflict must not overwrite",
    );
    // One conflict must not block the remaining skills.
    for (const name of names.slice(1)) {
      assert.ok(
        existsSync(join(skillsDir, name)),
        `skill ${name} should still be linked despite conflict`,
      );
    }
    console.log(
      "  ✓ install antigravity skill conflict → preserve user content",
    );
  });
});

test("testInstallAntigravityCreatesMissingConfigDir", () => {
  withTempHome((home) => {
    // ~/.gemini exists but ~/.gemini/config does not — the app's first run
    // may stop short of creating the config dir (plan §5 escape hatch).
    mkdirSync(join(home, ".gemini"), { recursive: true });
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf-8"),
    ) as { mcpServers?: Record<string, unknown> };
    assert.ok(mcp.mcpServers?.fapony, `got: ${err}`);
    console.log(
      "  ✓ install antigravity missing config/ → created recursively",
    );
  });
});

test("testInstallAntigravityAgyPathWithoutGeminiDir", () => {
  withTempHome((home) => {
    // No ~/.gemini at all, but `agy` on PATH → treated as installed,
    // ~/.gemini/config created on write.
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallAntigravity(false, {
          exit: testExit,
          homedir: () => home,
          checkCmd: (cmd) => cmd === "agy",
        }),
      ),
    );
    const mcp = JSON.parse(
      readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf-8"),
    ) as { mcpServers?: Record<string, unknown> };
    assert.ok(mcp.mcpServers?.fapony, `got: ${err}`);
    console.log(
      "  ✓ install antigravity agy on PATH, no ~/.gemini → creates tree",
    );
  });
});

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
