import { test } from "bun:test";
// test/install/detect.test.ts — detectClients (which MCP clients exist here)

import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectClients, type InstallDeps } from "../../src/install.js";
import { withTempHome } from "./helpers.js";

test("testDetectClientsAllFound", () => {
  withTempHome((home) => {
    // claude: checkCmd returns true
    // antigravity: ~/.gemini exists
    mkdirSync(join(home, ".gemini"), { recursive: true });
    // cursor: ~/.cursor exists
    mkdirSync(join(home, ".cursor"), { recursive: true });
    // opencode: config exists
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");
    // zcode: config exists
    const zcDir = join(home, ".zcode", "cli");
    mkdirSync(zcDir, { recursive: true });
    writeFileSync(join(zcDir, "config.json"), "{}");
    // codex: config exists
    const cdDir = join(home, ".codex");
    mkdirSync(cdDir, { recursive: true });
    writeFileSync(join(cdDir, "config.toml"), "");

    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => true,
    };
    const result = detectClients(deps);
    assert.equal(result.length, 6);
    assert.ok(
      result.every((d) => d.installed),
      "all should be installed",
    );
    console.log("  ✓ detect clients → all found");
  });
});

test("testDetectClientsNoneFound", () => {
  withTempHome((home) => {
    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false,
    };
    const result = detectClients(deps);
    assert.equal(result.length, 6);
    assert.ok(
      result.every((d) => !d.installed),
      "none should be installed",
    );
    assert.ok(result.every((d) => d.platform.length > 0));
    console.log("  ✓ detect clients → none found");
  });
});

test("testDetectClientsMixed", () => {
  withTempHome((home) => {
    // Only opencode config exists
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");

    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false, // claude not on PATH
    };
    const result = detectClients(deps);
    const opencode = result.find((d) => d.platform === "opencode");
    const claude = result.find((d) => d.platform === "claude");
    assert.ok(opencode?.installed, "opencode should be found");
    assert.ok(!claude?.installed, "claude should not be found");
    console.log("  ✓ detect clients → mixed");
  });
});

test("testDetectAntigravityViaAgyBinary", () => {
  withTempHome((home) => {
    // No ~/.gemini, but `agy` on PATH → still detected (plan: detect from
    // ~/.gemini OR binary agy).
    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: (cmd) => cmd === "agy",
    };
    const result = detectClients(deps);
    const antigravity = result.find((d) => d.platform === "antigravity");
    assert.ok(antigravity?.installed, "antigravity should be found via agy");
    assert.ok(
      antigravity.why.includes("agy"),
      `why should mention agy, got: ${antigravity.why}`,
    );
    const claude = result.find((d) => d.platform === "claude");
    assert.ok(!claude?.installed, "claude should not be found");
    console.log("  ✓ detect antigravity via agy CLI (no ~/.gemini)");
  });
});
