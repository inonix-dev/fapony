// test/plan-seed.test.ts — tests for `fapony plan-seed` (src/plan-seed.ts)

import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdPlanSeed } from "../src/plan-seed.js";
import { captureErrors } from "./helpers.js";

// Fixture with one module dir + one root file. The mem/ledger reads inside
// Context (fapony) tolerate any cwd (no log → empty block), so a plain temp
// dir is enough — no git repo needed.
function withFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-plan-seed-"));
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "calc.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// cmdPlanSeed resolves planDir/specDir against process.cwd() — run fn there.
function withCwd(dir: string, fn: () => void): void {
  const orig = process.cwd();
  process.chdir(dir);
  try {
    fn();
  } finally {
    process.chdir(orig);
  }
}

export function testPlanSeedWritesPlan(): void {
  withFixture((dir) => {
    withCwd(dir, () => {
      cmdPlanSeed(["foo"]);
      const planPath = join(dir, ".fapony", "plan", "PLAN-foo.md");
      assert.ok(existsSync(planPath), "PLAN-foo.md written");
      const body = readFileSync(planPath, "utf-8");
      // §2 comes from the live map, tagged — not a placeholder
      assert.match(body, /- src\/ — \d+ file\(s\) `\(fapony map\)`/);
      // §5 exists (analyze output — empty tree says "no findings", tagged section)
      assert.match(body, /## 5\. Risks/);
      // judgment sections are agent slots, not pre-invented
      assert.match(body, /_\(agent เติม\)_/);
      // frontmatter for plan_list
      assert.match(body, /^---\nkind: unit\nstatus: active\n---/);
    });
  });
  console.log("  ✓ plan-seed writes PLAN with map-tagged Scope + agent slots");
}

export function testPlanSeedNoOverwrite(): void {
  withFixture((dir) => {
    withCwd(dir, () => {
      cmdPlanSeed(["foo"]);
      const planPath = join(dir, ".fapony", "plan", "PLAN-foo.md");
      const before = readFileSync(planPath, "utf-8");
      let code: number | null = null;
      const origExit = process.exit;
      const errs = captureErrors(() => {
        process.exit = ((c?: number) => {
          code = c ?? 0;
          throw new Error("__exit__");
        }) as never;
        try {
          cmdPlanSeed(["foo"]);
        } catch {
          // exit stub unwinds
        } finally {
          process.exit = origExit;
        }
      });
      assert.equal(code, 1);
      assert.match(errs, /already exists/);
      assert.equal(readFileSync(planPath, "utf-8"), before, "file untouched");
    });
  });
  console.log("  ✓ plan-seed refuses to overwrite an existing plan");
}

export function testPlanSeedSpecSignatures(): void {
  withFixture((dir) => {
    withCwd(dir, () => {
      cmdPlanSeed(["foo", "--spec"]);
      const specPath = join(dir, ".fapony", "spec", "SPEC-foo.md");
      const planPath = join(dir, ".fapony", "plan", "PLAN-foo.md");
      const spec = readFileSync(specPath, "utf-8");
      const plan = readFileSync(planPath, "utf-8");
      // chunk index links the module anchor
      assert.match(spec, /\[src\]\(#src\)/);
      assert.match(spec, /id="src"/);
      // signature matches the source declaration verbatim
      assert.match(
        spec,
        /`1`\s+fn\s+export function add\(a: number, b: number\): number/,
      );
      // plan links out to spec, holds no signatures itself
      assert.match(plan, /SPEC-foo\.md/);
      assert.doesNotMatch(plan, /export function add/);
      // spec backlinks the plan
      assert.match(spec, /Used by.*PLAN-foo/);
    });
  });
  console.log(
    "  ✓ plan-seed --spec writes chunked SPEC with verbatim signatures",
  );
}

export function testPlanSeedConfigFallback(): void {
  withFixture((dir) => {
    // A config file that sets custom dirs must be honoured; a broken one must
    // fall back to defaults without throwing.
    writeFileSync(
      join(dir, "fapony.config.json"),
      JSON.stringify({
        paths: { planDir: "docs/plans", specDir: "docs/specs" },
      }),
    );
    withCwd(dir, () => {
      cmdPlanSeed(["bar"]);
      assert.ok(existsSync(join(dir, "docs", "plans", "PLAN-bar.md")));
      assert.ok(!existsSync(join(dir, ".fapony", "plan", "PLAN-bar.md")));
    });
    writeFileSync(join(dir, "fapony.config.json"), "{broken json");
    withCwd(dir, () => {
      cmdPlanSeed(["baz"]);
      assert.ok(existsSync(join(dir, ".fapony", "plan", "PLAN-baz.md")));
    });
  });
  console.log(
    "  ✓ plan-seed honours config planDir; broken config falls back to defaults",
  );
}
