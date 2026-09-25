import { test } from "bun:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Config,
  evidenceFile,
  loadConfig,
  planDir,
  safetyDeny,
  specDir,
} from "../src/core/config.js";
import { assertSafe } from "../src/safety.js";
import { fillPrompt, templateArgs } from "../src/util.js";

function baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

test("testConfigDefaults", () => {
  const config = baseConfig();
  // planDir/specDir are hardcoded — not configurable (gitignored = private).
  assert.equal(planDir(), ".fapony/plan");
  assert.equal(specDir(), ".fapony/spec");
  assert.equal(evidenceFile(config), ".fapony/evidence.json");
  assert.equal(safetyDeny(config).length, 4);

  console.log("  ✓ config defaults = old hardcodes");
});

test("testConfigFileOverrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-cfg-"));
  try {
    const file = join(dir, "fapony.config.json");
    writeFileSync(
      file,
      JSON.stringify({
        review: { maxRounds: 5 },
        paths: { evidenceFile: "config/evidence.json" },
        safety: { deny: ["custom-bad-cmd"] },
      }),
    );
    const config = loadConfig(file);
    assert.equal(config.review.maxRounds, 5);
    assert.equal(evidenceFile(config), "config/evidence.json");
    assert.deepEqual(safetyDeny(config), ["custom-bad-cmd"]);
    // planDir/specDir are always the same (hardcoded)
    assert.equal(planDir(), ".fapony/plan");
    assert.equal(specDir(), ".fapony/spec");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ config file overrides");
});

test("testConfigUnknownKeysRideAlong", () => {
  // Loop-era keys in the wild are never read — loadConfig must not throw,
  // and the live fields must still resolve.
  const dir = mkdtempSync(join(tmpdir(), "fapony-cfg-"));
  try {
    const file = join(dir, "fapony.config.json");
    writeFileSync(
      file,
      JSON.stringify({
        executor: { cmd: ["opencode", "run"], timeoutMin: 45 },
        review: {
          bigDiff: { files: 15, lines: 400 },
          maxRounds: 3,
          gate: ["claude", "-p", "/code-review high"],
          prefilter: null,
        },
        markers: { handoff: "## HANDOFF" },
      }),
    );
    const config = loadConfig(file);
    assert.equal(config.review.maxRounds, 3);
    assert.equal(planDir(), ".fapony/plan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ config unknown (loop-era) keys ride along harmlessly");
});

test("testCustomSafetyDeny", () => {
  // custom list replaces the default: default-dangerous now allowed…
  assertSafe(["git", "reset", "--hard"], ["my-own-ban"]);
  // …and the custom pattern blocks
  assert.throws(
    () => assertSafe(["run", "my-own-ban", "x"], ["my-own-ban"]),
    /dangerous/,
  );
  // default still blocks without override
  assert.throws(() => assertSafe(["git", "reset", "--hard"]), /dangerous/);
  // invalid regex source surfaces loudly (fail-fast, not silent allow)
  assert.throws(() => assertSafe(["anything"], ["([invalid"]), /./);

  console.log("  ✓ custom safety deny");
});

test("testTemplateArgsReplaceAll", () => {
  const out = templateArgs(["claude", "-p", "{model}", "{PROMPT}", "{model}"], {
    model: "opus",
    PROMPT: "hi",
  });
  assert.deepEqual(out, ["claude", "-p", "opus", "hi", "opus"]);

  const filled = fillPrompt("run {{RUN_ID}} in {{WORKTREE}} ({{RUN_ID}})", {
    RUN_ID: "7",
    WORKTREE: "wt",
  });
  assert.equal(filled, "run 7 in wt (7)");

  // $ sequences in values must be literal, not replace() special patterns
  const tricky = templateArgs(["echo", "{MSG}"], { MSG: "$& $' $` $$" });
  assert.equal(tricky[1], "$& $' $` $$");
  const trickyFilled = fillPrompt("PLAN:\n{{PLAN}}", {
    PLAN: "costs $100 and $& more",
  });
  assert.equal(trickyFilled, "PLAN:\ncosts $100 and $& more");

  console.log("  ✓ templateArgs replaceAll + fillPrompt");
});
