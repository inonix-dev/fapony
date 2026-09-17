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
      // §2 is repetition, not a directory listing: one scanned line + the
      // explicit "nothing repeats" line for a one-export fixture
      assert.match(
        body,
        /- scanned: \. — 1 file\(s\), 1 export\(s\) `\(source scan\)`/,
      );
      assert.match(
        body,
        /no export-name prefix repeating across 2\+ directories/,
      );
      // §5 exists (analyze output — an unimported calc.ts is an orphan row)
      assert.match(body, /## 5\. Risks/);
      assert.match(body, /\*\*orphan\*\*/);
      // judgment sections are agent slots, not pre-invented
      assert.match(body, /_\(agent เติม\)_/);
      // frontmatter for plan_list
      assert.match(body, /^---\nkind: unit\nstatus: active\n---/);
    });
  });
  console.log("  ✓ plan-seed writes PLAN with repetition §2 + agent slots");
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
      // small fixture → no scope echo line, no cap markers
      assert.ok(!spec.includes("**Scope:**"), "no scope echo without --scope");
      assert.ok(!spec.includes("… +"), "caps stay silent on a small tree");
    });
  });
  console.log(
    "  ✓ plan-seed --spec writes chunked SPEC with verbatim signatures",
  );
}

export function testPlanSeedRepetitionCluster(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-plan-seed-rep-"));
  try {
    // format* spans fmt/ and render/ → a real cross-directory repetition.
    // parse* lives entirely in fmt/ → that is just fmt/'s naming convention,
    // and reporting it would spend §2 telling the reader the folder's own rule.
    const place: [string, string][] = [
      ["fmt", "User"],
      ["fmt", "Order"],
      ["render", "Date"],
    ];
    for (const [sub, name] of place) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(
        join(dir, sub, `format${name}.ts`),
        `export function format${name}(x: string): string { return x; }\n`,
      );
    }
    for (const name of ["Json", "Yaml", "Toml"]) {
      writeFileSync(
        join(dir, "fmt", `parse${name}.ts`),
        `export function parse${name}(x: string): string { return x; }\n`,
      );
    }
    withCwd(dir, () => {
      cmdPlanSeed(["rep"]);
      const body = readFileSync(
        join(dir, ".fapony", "plan", "PLAN-rep.md"),
        "utf-8",
      );
      assert.match(
        body,
        /- format\* — 3 export\(s\) across fmt, render: formatDate, formatOrder, formatUser `\(source scan\)`/,
      );
      assert.ok(
        !body.includes("parse*"),
        "a cluster inside one directory is that directory's naming convention",
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ plan-seed §2 reports cross-directory repetition only");
}

export function testPlanSeedScopeFilters(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-plan-seed-scope-"));
  try {
    const comp = join(dir, "apps", "vela", "src", "components");
    mkdirSync(comp, { recursive: true });
    mkdirSync(join(dir, "other"), { recursive: true });
    for (const name of ["User", "Order", "Date"]) {
      writeFileSync(
        join(comp, `format${name}.ts`),
        `export function format${name}(x: string): string { return x; }\n`,
      );
    }
    writeFileSync(
      join(dir, "other", "lonely.ts"),
      "export function lonelyThing(): void {}\n",
    );
    // §8 prior art: one shipped plan that names the scope, one that doesn't.
    mkdirSync(join(dir, ".fapony", "done"), { recursive: true });
    mkdirSync(join(dir, ".fapony", "spec"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "done", "PLAN-formatters.md"),
      "# PLAN-formatters — money formatting\n\n> shipped 2026-01-02\n\ntouched apps/vela/src/components\n",
    );
    writeFileSync(
      join(dir, ".fapony", "done", "PLAN-elsewhere.md"),
      "# PLAN-elsewhere\n\nonly ever touched other/\n",
    );
    withCwd(dir, () => {
      // --scope value comes FIRST — it must never be mistaken for the name
      cmdPlanSeed(["--scope", "apps/vela/src/components", "scoped"]);
      const plan = readFileSync(
        join(dir, ".fapony", "plan", "PLAN-scoped.md"),
        "utf-8",
      );
      assert.ok(plan.includes("PLAN-scoped"), "--scope value is not the name");
      // §2 reports only the scoped tree
      assert.match(
        plan,
        /- scanned: apps\/vela\/src\/components — 3 file\(s\), 3 export\(s\)/,
      );
      assert.ok(!plan.includes("other/"), "§2 stays inside the scope");
      // §5 drops findings outside the scope (done criterion 3)
      assert.ok(
        !plan.includes("other/lonely"),
        "§5 carries no finding outside the scope",
      );
      assert.match(
        plan,
        /\*\*orphan\*\* apps\/vela\/src\/components\/formatUser\.ts/,
        "in-scope findings stay",
      );

      // §8 points at the shipped plan that already decided something here —
      // and never at the one that didn't (that list would match everything)
      assert.match(
        plan,
        // title keeps only what the filename doesn't already say
        /ตัดสินไปแล้ว: \[PLAN-formatters\.md\]\(\.\.\/done\/PLAN-formatters\.md\) — money formatting \(shipped 2026-01-02\)/,
      );
      assert.ok(!plan.includes("PLAN-elsewhere"), "§8 stays inside the scope");

      // Same tree, no --scope → the whole cwd is in scope, lonely shows up
      cmdPlanSeed(["wide"]);
      const wide = readFileSync(
        join(dir, ".fapony", "plan", "PLAN-wide.md"),
        "utf-8",
      );
      assert.match(wide, /\*\*orphan\*\* other\/lonely\.ts/);
      // …and §8 goes quiet: with no scope every shipped plan matches, so a
      // list of everything would point at nothing
      assert.ok(
        !wide.includes("ตัดสินไปแล้ว"),
        "§8 prior art needs a --scope to join on",
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ plan-seed --scope filters §2/§5/§8 and never eats the name");
}

export function testPlanSeedCapsHold(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-plan-seed-caps-"));
  try {
    // 6 modules × 10 files × 4 exports — enough to trip the per-chunk cap,
    // the whole-SPEC cap, the §2 cluster cap and the §5 risks cap. The token
    // is keyed by FILE index, so each alpha<f> family appears in all 6
    // modules: 10 cross-directory clusters, over the 5 §2 shows.
    for (let m = 0; m < 6; m++) {
      const mod = join(dir, `mod${m}`);
      mkdirSync(mod, { recursive: true });
      for (let f = 0; f < 10; f++) {
        writeFileSync(
          join(mod, `file${f}.ts`),
          [
            `export function alpha${f}One(): void {}`,
            `export function alpha${f}Two(): void {}`,
            `export function alpha${f}Three(): void {}`,
            `export function beta${f}One(): void {}`,
            "",
          ].join("\n"),
        );
      }
    }
    withCwd(dir, () => {
      cmdPlanSeed(["big", "--spec"]);
      const plan = readFileSync(
        join(dir, ".fapony", "plan", "PLAN-big.md"),
        "utf-8",
      );
      const spec = readFileSync(
        join(dir, ".fapony", "spec", "SPEC-big.md"),
        "utf-8",
      );
      // Done criterion 1 (§3): PLAN ≤ 60, SPEC ≤ 200 — content lines
      // (a trailing newline is not a line).
      assert.ok(
        plan.replace(/\n$/, "").split("\n").length <= 60,
        `PLAN capped (got ${plan.split("\n").length})`,
      );
      assert.ok(
        spec.replace(/\n$/, "").split("\n").length <= 200,
        `SPEC capped (got ${spec.split("\n").length})`,
      );
      // Caps always say what was cut, never cut silently.
      assert.match(spec, /… \+\d+ more signatures/);
      assert.match(spec, /… \+\d+ more lines/);
      assert.match(plan, /… \+\d+ more clusters/);
      assert.match(
        plan,
        /… \+\d+ more \(run `fapony analyze` for the full list\)/,
      );
      // §2 cluster cap: 5 shown — members are never dropped, the directory
      // list is what gets cut, and it says how many it cut.
      assert.match(
        plan,
        /- alpha0\* — 3 export\(s\) across mod0, mod1, mod2 \+3 more: alpha0One, alpha0Three, alpha0Two/,
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ plan-seed caps hold: PLAN ≤ 60 / SPEC ≤ 200 with markers");
}

export function testPlanSeedSingleFileScope(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-plan-seed-file-"));
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "util.ts"),
      [
        "export function fmt(x: string): string { return x; }",
        "export function parse(s: string): unknown { return s; }",
        "",
      ].join("\n"),
    );
    withCwd(dir, () => {
      cmdPlanSeed(["file", "--spec", "--scope", "src/util.ts"]);
      const spec = readFileSync(
        join(dir, ".fapony", "spec", "SPEC-file.md"),
        "utf-8",
      );
      const plan = readFileSync(
        join(dir, ".fapony", "plan", "PLAN-file.md"),
        "utf-8",
      );
      // §2 reports the single-file scope as exports found
      assert.match(plan, /scanned: src\/util\.ts — 1 file\(s\), 2 export\(s\)/);
      // SPEC chunk index links the file
      assert.match(spec, /\[util\.ts\]\(#util-ts\)/);
      // Signatures are present
      assert.match(spec, /export function fmt/);
      assert.match(spec, /export function parse/);
      // Scope echo present in SPEC
      assert.match(spec, /\*\*Scope:\*\* src\/util\.ts/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    "  ✓ plan-seed --scope <file> produces SPEC chunk with signatures",
  );
}

export function testPlanSeedOverlapScopeDedup(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-plan-seed-overlap-"));
  try {
    mkdirSync(join(dir, "src", "utils"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src", "utils", "b.ts"), "export const b = 2;\n");
    withCwd(dir, () => {
      cmdPlanSeed(["overlap", "--scope", "src", "--scope", "src/utils"]);
      const plan = readFileSync(
        join(dir, ".fapony", "plan", "PLAN-overlap.md"),
        "utf-8",
      );
      // §2 should count each file once, not twice
      assert.match(plan, /2 file\(s\), 2 export\(s\)/);
      assert.doesNotMatch(plan, /4 file\(s\)/, "no double-count");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    "  ✓ plan-seed prunes nested --scope roots to avoid double-count",
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
