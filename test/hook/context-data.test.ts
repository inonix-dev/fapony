import { test } from "bun:test";
// test/hook/context-data.test.ts — debt lines attached by the edit hint, and
// the hint-impact precision that reads them back.
import assert from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeHintImpact,
  readContextData,
  recordHintFire,
} from "../../src/hook.js";
import { withTempRepo } from "./helpers.js";

test("testContextShowsDebtBeforeFix", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          {
            id: "mutation-hooks",
            rule: "use useAppForm instead of raw useMutation",
            where: "src",
            stale: "\\buseMutation\\(",
            checker: null,
          },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    const p = join(dir, "src", "dirty.ts");
    writeFileSync(p, "export const m = () => useMutation(fn);\n");
    const lines = readContextData(p, dir)?.debtLines ?? [];
    assert.equal(lines.length, 1);
    assert.match(lines[0], /fapony debt: \[mutation-hooks\]/);
    const clean = join(dir, "src", "clean.ts");
    writeFileSync(clean, "export const ok = 1;\n");
    assert.deepEqual(readContextData(clean, dir)?.debtLines, []);
  });
  console.log("  ✓ context → debt line before the fix, silence on clean files");
});

// --- Hint impact ---

test("testComputeHintImpact", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          {
            id: "no-use-mutation",
            rule: "use useAppForm instead of raw useMutation",
            where: "src",
            stale: "\\buseMutation\\(",
            checker: null,
          },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    const p = join(dir, "src", "dirty.ts");
    writeFileSync(p, "export const m = () => useMutation(fn);\n");

    process.env.FAPONY_STATE_DIR = dir;
    try {
      recordHintFire({
        ts: new Date().toISOString(),
        worktree: dir,
        surface: "debt",
        file: "src/dirty.ts",
        count: 1,
        ids: ["no-use-mutation"],
      });

      const before = computeHintImpact();
      assert.equal(before.fired, 1);
      assert.equal(before.debt.shown, 1);
      assert.equal(before.debt.resolved, 0);

      writeFileSync(p, "export const ok = 1;\n");

      const after = computeHintImpact();
      assert.equal(after.debt.shown, 1);
      assert.equal(after.debt.resolved, 1);
    } finally {
      delete process.env.FAPONY_STATE_DIR;
    }
  });
  console.log("  ✓ computeHintImpact: debt precision counts resolved ids");
});

test("testComputeHintImpactNoLog", () => {
  process.env.FAPONY_STATE_DIR = mkdtempSync(join(tmpdir(), "fapony-no-log-"));
  try {
    const impact = computeHintImpact();
    assert.equal(impact.fired, 0);
    assert.equal(impact.debt.shown, 0);
  } finally {
    delete process.env.FAPONY_STATE_DIR;
  }
  console.log("  ✓ computeHintImpact: no log → zero counts, no error");
});
