// test/review-seed.test.ts — tests for `fapony review-seed` (src/review-seed.ts)

import assert from "node:assert";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSeed, SeedError } from "../src/review-seed.js";

/**
 * Fixture repo: init commit (from withTempRepo), then one commit with source
 * files, then a dirty worktree: modified b.ts, staged d.ts, untracked c.ts.
 * Graph shape: src/a.ts ← test/a.test.ts (tested); b/c/d have no dependents.
 */
function withFixture(
  fn: (dir: string, rootSha: string, commit2: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-review-seed-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test repo\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
    const rootSha = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();

    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(
      join(dir, "src", "a.ts"),
      "export function a(): number { return 1; }\n",
    );
    writeFileSync(
      join(dir, "src", "b.ts"),
      "export function b(): number { return 2; }\n",
    );
    writeFileSync(
      join(dir, "test", "a.test.ts"),
      'import { a } from "../src/a.js";\nconsole.log(a);\n',
    );
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "src files"', { cwd: dir, stdio: "ignore" });
    const commit2 = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();

    // dirty worktree
    writeFileSync(
      join(dir, "src", "b.ts"),
      "export function b(): number { return 22; }\n",
    );
    writeFileSync(
      join(dir, "src", "d.ts"),
      "export function d(): number { return 4; }\n",
    );
    execSync("git add src/d.ts", { cwd: dir, stdio: "ignore" });
    writeFileSync(
      join(dir, "src", "c.ts"),
      "export function c(): number { return 3; }\n",
    );

    fn(dir, rootSha, commit2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** All paths in the tree (relative), for the no-write assertion. */
function treePaths(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const p = join(base, e.name);
    out.push(p.slice(dir.length + 1));
    if (e.isDirectory()) treePaths(dir, p, out);
  }
  return out.sort();
}

export function testReviewSeedScopeFlags(): void {
  withFixture((dir, rootSha, commit2) => {
    // default = diff HEAD + untracked (staged d.ts rides along in diff HEAD)
    const def = renderSeed([], dir);
    assert.match(def, /\(diff HEAD \+ untracked\)/);
    for (const p of ["src/b.ts", "src/c.ts (untracked)", "src/d.ts"]) {
      assert.match(def, new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // --staged = only what is staged
    const staged = renderSeed(["--staged"], dir);
    assert.match(staged, /src\/d\.ts/);
    assert.doesNotMatch(staged, /src\/b\.ts/);
    // --commit = that commit's files, parents echoed
    const commit = renderSeed(["--commit", commit2], dir);
    assert.match(commit, /--commit \w+ \(\w+\.\.\w+\)/);
    assert.match(commit, /src\/a\.ts/);
    assert.match(commit, /test\/a\.test\.ts/);
    assert.doesNotMatch(commit, /src\/c\.ts/);
    // --range = three-dot, merge-base echoed as resolved SHAs
    const range = renderSeed(["--range", "HEAD~1...HEAD"], dir);
    assert.match(range, /HEAD~1\.\.\.HEAD = \w+…\w+/);
    assert.match(range, /src\/a\.ts/);
    // uncommitted edit (+1-1), untracked c.ts and staged d.ts are not in the range
    assert.doesNotMatch(range, /src\/b\.ts \+1-1/);
    assert.doesNotMatch(range, /src\/c\.ts/);
    assert.doesNotMatch(range, /src\/d\.ts/);
    // --files = pass-through for named files, marked as given; a path that
    // exists as neither file nor dir is dropped and reported, never counted
    // as a one-row scope
    const files = renderSeed(["--files", "src/b.ts,missing.ts"], dir);
    assert.match(files, /--files \(as given\)/);
    assert.match(files, /not found \(1\): missing\.ts — dropped from scope/);
    assert.doesNotMatch(files, /missing\.ts \(as given\)/);
    // one scope flag at a time
    assert.throws(
      () => renderSeed(["--staged", "--files", "x.ts"], dir),
      SeedError,
    );
    // two-dot range is rejected (merge-base semantics are the point)
    assert.throws(() => renderSeed(["--range", "a..b"], dir), SeedError);
    // root commit: no parent — falls back to tree, label says so
    const root = renderSeed(["--commit", rootSha], dir);
    assert.match(root, /root commit — vs empty tree/);
    assert.match(root, /README\.md/);
  });
  console.log(
    "  ✓ review-seed scope flags match their declared git expression",
  );
}

export function testReviewSeedStructure(): void {
  withFixture((dir) => {
    const out = renderSeed(["--files", "src/a.ts,src/b.ts"], dir);
    // importers: a is imported by the test, b by nobody
    assert.match(out, /importers \(static\):/);
    assert.match(out, /src\/a\.ts ← test\/a\.test\.ts/);
    // untested: b (and not a — the test file imports it)
    assert.match(out, /untested \(1\):/);
    assert.match(out, /src\/b\.ts/);
    assert.doesNotMatch(out, /untested \(1\):\n {2}src\/a\.ts/);
    // signatures: current scan with name:line + real declaration text
    assert.match(out, /signatures \(current\):/);
    assert.match(out, /src\/b\.ts — b:1 export function b\(\): number/);
    // disclaimer is mandatory on every output
    assert.match(
      out,
      /static graph only — seed is where to enter, not what is verified/,
    );
    // ≤30 lines
    assert.ok(
      out.split("\n").length <= 30,
      `output capped at 30 lines, got ${out.split("\n").length}`,
    );
  });
  console.log("  ✓ review-seed structure lines are facts-only and capped");
}

export function testReviewSeedRenames(): void {
  // plain file rename — one annotated row, never a delete+add pair
  withFixture((dir) => {
    writeFileSync(join(dir, "src", "old.ts"), "export const old = 1;\n");
    execSync("git add src/old.ts", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "add old" src/old.ts', {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git mv src/old.ts src/new.ts", { cwd: dir, stdio: "ignore" });
    const staged = renderSeed(["--staged"], dir);
    assert.match(staged, /src\/new\.ts \(renamed from src\/old\.ts\)/);
    assert.doesNotMatch(staged, /src\/old\.ts \+\d/);
  });
  // directory rename — git's brace form {a => b}/x.ts parsed back to full
  // paths; git's internal syntax never leaks into the output
  const dir = mkdtempSync(join(tmpdir(), "fapony-review-seed-dirren-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "src", "y.ts"), "export const y = 2;\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "src"', { cwd: dir, stdio: "ignore" });
    execSync("git mv src pkg", { cwd: dir, stdio: "ignore" });
    const staged = renderSeed(["--staged"], dir);
    assert.match(staged, /pkg\/x\.ts \(renamed from src\/x\.ts\)/);
    assert.match(staged, /pkg\/y\.ts \(renamed from src\/y\.ts\)/);
    assert.doesNotMatch(staged, /\{/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    "  ✓ review-seed parses renames (-M) — one row, annotated, brace form expanded",
  );
}

export function testReviewSeedDeterministicAndNoWrite(): void {
  withFixture((dir) => {
    const before = treePaths(dir);
    const a = renderSeed([], dir);
    const b = renderSeed([], dir);
    assert.equal(a, b, "same input → same bytes");
    assert.deepEqual(treePaths(dir), before, "no file written outside stdout");
  });
  console.log("  ✓ review-seed is byte-deterministic and writes nothing");
}

export function testReviewSeedPlanCrossCheck(): void {
  withFixture((dir) => {
    // plan whose files[] disagree with the default diff — both directions
    const planDir = join(dir, ".fapony", "plan");
    mkdirSync(planDir, { recursive: true });
    const planPath = join(planDir, "PLAN-x.md");
    writeFileSync(
      planPath,
      "---\nkind: unit\nstatus: active\nfiles: src/ghost.ts, src/nobody-writes-this.ts\n---\n\n# PLAN-x\n",
    );
    const rel = ".fapony/plan/PLAN-x.md";
    const mismatch = renderSeed(["--plan", rel], dir);
    assert.match(mismatch, /changed-not-in-plan:/);
    assert.match(mismatch, /src\/b\.ts/);
    assert.match(mismatch, /in-plan-not-changed:/);
    assert.match(mismatch, /src\/ghost\.ts/);

    // plan in sync with the diff → no cross-check lines at all
    writeFileSync(
      planPath,
      "---\nkind: unit\nfiles: src/b.ts, src/d.ts, src/c.ts, " +
        rel +
        "\n---\n\n# PLAN-x\n",
    );
    const sync = renderSeed(["--plan", rel], dir);
    assert.doesNotMatch(sync, /changed-not-in-plan/);
    assert.doesNotMatch(sync, /in-plan-not-changed/);

    // plan without files[] frontmatter → honest skip, default-diff fallback
    writeFileSync(planPath, "---\nkind: unit\n---\n\n# PLAN-x\n");
    const noFiles = renderSeed(["--plan", rel], dir);
    assert.match(noFiles, /no files: frontmatter/);
    assert.match(
      noFiles,
      /plan cross-check: plan has no files: frontmatter — skipped/,
    );

    // missing plan file → one clean line, no stack trace
    assert.throws(
      () => renderSeed(["--plan", ".fapony/plan/PLAN-nope.md"], dir),
      (e: unknown) => {
        assert.ok(e instanceof SeedError);
        assert.match(e.message, /plan file not found/);
        return true;
      },
    );
  });
  console.log(
    "  ✓ review-seed --plan cross-checks both ways and stays honest when empty",
  );
}

export function testReviewSeedNotARepo(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-review-seed-norepo-"));
  try {
    assert.throws(
      () => renderSeed([], dir),
      (e: unknown) => {
        assert.ok(e instanceof SeedError);
        assert.match(e.message, /not a git repository/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ review-seed outside a repo → one clean error line");
}

export function testReviewSeedStateDbUntouched(): void {
  withFixture((dir) => {
    // The seed never opens state.db — point FAPONY_STATE_DIR at an empty temp
    // dir and assert nothing appears there.
    const stateDir = mkdtempSync(join(tmpdir(), "fapony-review-seed-state-"));
    const orig = process.env.FAPONY_STATE_DIR;
    process.env.FAPONY_STATE_DIR = stateDir;
    try {
      renderSeed([], dir);
      assert.ok(
        !existsSync(join(stateDir, "state.db")),
        "state.db must not be created",
      );
    } finally {
      if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
      else process.env.FAPONY_STATE_DIR = orig;
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ review-seed never touches the fapony state db");
}

export function testReviewSeedBarrelAndScopeList(): void {
  withFixture((dir) => {
    // A barrel between the test and the module: src/core.ts is exercised by
    // test/a.test.ts through src/index.ts, so it must not read as untested.
    // review-seed and `analyze` share one graph — they must not disagree.
    writeFileSync(
      join(dir, "src", "core.ts"),
      "export function core(): number { return 7; }\n",
    );
    writeFileSync(join(dir, "src", "index.ts"), 'export * from "./core.js";\n');
    writeFileSync(
      join(dir, "test", "a.test.ts"),
      'import { a } from "../src/a.js";\nimport { core } from "../src/index.js";\nexport const t = a() + core();\n',
    );
    const out = renderSeed(["--files", "src/core.ts"], dir);
    assert.doesNotMatch(
      out,
      /untested/,
      "a test reaching src/core.ts through the barrel is coverage",
    );
  });
  withFixture((dir) => {
    // The changed list is the review's scope: every file has to appear in it,
    // not just the first few that fit on three wrapped lines.
    const names: string[] = [];
    for (let i = 0; i < 12; i++) {
      const rel = `src/wide${i}.ts`;
      names.push(rel);
      writeFileSync(
        join(dir, rel),
        `export function wide${i}(): number { return ${i}; }\n`,
      );
    }
    const out = renderSeed(["--files", names.join(",")], dir);
    assert.match(out, /changed \(12\):/);
    for (const rel of names) {
      assert.ok(out.includes(rel), `${rel} missing from the changed list`);
    }
  });
  console.log(
    "  ✓ review-seed sees through barrels and lists every changed file",
  );
}

/**
 * `--files` accepts directories: the caller thinks in zones, not file names.
 * A dir expands to source files under it (same walk the graph uses, so
 * importers/signatures still hit); an empty dir speaks; a wrong path is
 * reported, never silent; expansion past the cap says what was cut.
 */
export function testReviewSeedFilesDirExpansion(): void {
  withFixture((dir) => {
    const out = renderSeed(["--files", "src/"], dir);
    assert.match(out, /--files \(dir-expanded\)/);
    for (const p of ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]) {
      assert.ok(out.includes(p), `${p} missing from dir expansion`);
    }
    assert.ok(
      !out.includes("(as given)"),
      `expanded files are not "as given":\n${out}`,
    );
    // graph facts still attach to expanded paths (same walk keys the graph)
    assert.match(out, /src\/a\.ts ← test\/a\.test\.ts/);
    assert.match(out, /signatures \(current\):/);
    assert.match(out, /src\/b\.ts — b:1 export function b\(\): number/);
  });
  withFixture((dir) => {
    // mixed: named file + wrong path + empty dir — each says its piece
    mkdirSync(join(dir, "src", "void"), { recursive: true });
    const out = renderSeed(["--files", "src/a.ts,ghost.ts,src/void"], dir);
    assert.match(out, /--files \(dir-expanded\)/);
    assert.match(out, /not found \(1\): ghost\.ts — dropped from scope/);
    assert.match(out, /src\/void \(dir\) — no source files under it/);
    assert.match(out, /src\/a\.ts ← test\/a\.test\.ts/);
    assert.doesNotMatch(out, /changed \(0\)/);
  });
  withFixture((dir) => {
    // every path wrong → the seed says so, it is never an empty look
    const out = renderSeed(["--files", "ghost.ts,also-gone.ts"], dir);
    assert.match(out, /not found \(2\): ghost\.ts, also-gone\.ts/);
    assert.match(out, /changed \(0\): nothing in this scope/);
  });
  withFixture((dir) => {
    // dir bigger than the cap → capped, and the cut is counted out loud
    mkdirSync(join(dir, "bulk"), { recursive: true });
    for (let i = 0; i < 45; i++) {
      const n = String(i).padStart(2, "0");
      writeFileSync(
        join(dir, "bulk", `f${n}.ts`),
        `export const f${n} = ${i};\n`,
      );
    }
    const out = renderSeed(["--files", "bulk"], dir);
    assert.match(out, /changed \(40\):/);
    assert.ok(out.includes("bulk/f00.ts"));
    assert.ok(!out.includes("bulk/f44.ts"), "cut file stays out of the list");
    assert.match(
      out,
      /\+5 more file\(s\) under the expanded dirs — capped at 40, narrow the scope/,
    );
    // Explicit files are the caller's words — a dir listed FIRST must not
    // spend the cap on inferred paths and drop them. Argument order is the
    // trap here: naming the files first passes even when placement is wrong.
    const mixed = renderSeed(
      ["--files", "bulk,src/a.ts,src/b.ts,src/c.ts,src/d.ts"],
      dir,
    );
    assert.match(mixed, /changed \(40\):/);
    for (const p of ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]) {
      assert.ok(
        mixed.includes(p),
        `named ${p} lost to dir expansion:\n${mixed}`,
      );
    }
    // and the cut is blamed on the dirs, because that is where it came from
    assert.match(mixed, /under the expanded dirs/);
    assert.doesNotMatch(mixed, /named file\(s\) past/);
  });
  withFixture((dir) => {
    // named files past the cap get their own note — not "under the expanded
    // dirs", which would be a lie about where the cut happened
    const names: string[] = [];
    for (let i = 0; i < 45; i++) {
      const rel = `src/n${String(i).padStart(2, "0")}.ts`;
      names.push(rel);
      writeFileSync(join(dir, rel), `export const n${i} = ${i};\n`);
    }
    const out = renderSeed(["--files", names.join(",")], dir);
    assert.match(out, /--files \(as given\)/);
    assert.match(out, /\+5 named file\(s\) past the 40 cap — narrow the scope/);
    assert.doesNotMatch(out, /under the expanded dirs/);
  });
  console.log(
    "  ✓ review-seed --files expands dirs (zone lookup), speaks on empty/wrong paths, counts cuts",
  );
}

/**
 * `--files` is a lookup, not a review: the caller named the paths, so the caps
 * that keep a 40-file diff readable must not hide the answer. Same file seen
 * through a diff scope stays capped — that is the review budget, unchanged.
 */
export function testReviewSeedFilesLookupUncapped(): void {
  withFixture((dir) => {
    const names = Array.from({ length: 9 }, (_, i) => `many${i}`);
    writeFileSync(
      join(dir, "src/many.ts"),
      `${names.map((n) => `export function ${n}(): number { return 0; }`).join("\n")}\n`,
    );

    const lookup = renderSeed(["--files", "src/many.ts"], dir);
    for (const n of names) {
      assert.ok(lookup.includes(`${n}:`), `${n} missing from --files lookup`);
    }
    assert.ok(
      !/\(\+\d+\)/.test(lookup),
      `--files must not truncate signatures:\n${lookup}`,
    );

    execSync("git add -A", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "many"', { cwd: dir, stdio: "ignore" });
    const sha = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    const review = renderSeed(["--commit", sha], dir);
    assert.match(
      review,
      /\(\+4\)/,
      `a diff scope still caps at 5 signatures:\n${review}`,
    );
  });
  console.log("  ✓ review-seed --files shows every signature, diff scopes cap");
}

/**
 * --body: one round trip instead of review-seed → Read. The slice runs from
 * the declaration to indent-out; --callers narrows file→file importers to
 * symbol→symbol textually (comments/strings count — documented, not hidden).
 */
export function testReviewSeedBodyAndCallers(): void {
  withFixture((dir) => {
    writeFileSync(
      join(dir, "src", "multi.ts"),
      [
        "export function outer(x: number): number {",
        "  if (x > 0) {",
        "    return inner(x);",
        "  }",
        "  return 0;",
        "}",
        "",
        "export const helper = (): void => {};",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "src", "user.ts"),
      'import { outer } from "./multi.js";\n// outer mention\nconst s = "outer in a string";\nconsole.log(outer(1));\n',
    );
    execSync("git add -A", { cwd: dir, stdio: "ignore" });

    const body = renderSeed(
      ["--files", "src/multi.ts", "--body", "outer"],
      dir,
    );
    assert.ok(body.includes("src/multi.ts:1 outer"), `decl line:\n${body}`);
    assert.ok(body.includes("return inner(x);"), `body slice:\n${body}`);
    assert.ok(
      body.includes("return 0;"),
      `slice must reach the last statement:\n${body}`,
    );
    // The closing brace sits at the declaration's own indent, so indent-out
    // stops one line short of it unless the closer is taken deliberately.
    const sliceLines = body.split("\n");
    assert.strictEqual(
      sliceLines[sliceLines.findIndex((l) => l.includes("return 0;")) + 1],
      "  }",
      `slice must end at the closing brace, not one line short:\n${body}`,
    );
    assert.ok(
      !body.includes("helper"),
      `must stop at indent-out, not swallow the next fn:\n${body}`,
    );
    assert.ok(
      !body.includes("importers"),
      `lookup mode suppresses standard sections:\n${body}`,
    );

    // One-liner returns itself.
    const one = renderSeed(
      ["--files", "src/multi.ts", "--body", "helper"],
      dir,
    );
    assert.ok(one.includes("export const helper"), `one-liner:\n${one}`);

    const callers = renderSeed(
      ["--files", "src/multi.ts", "--callers", "outer"],
      dir,
    );
    assert.ok(
      callers.includes("src/user.ts:1,2,3,4"),
      `caller hits with line numbers:\n${callers}`,
    );
    assert.ok(
      callers.includes("may be comments/strings"),
      `textual caveat must be stated:\n${callers}`,
    );

    const missing = renderSeed(
      ["--files", "src/multi.ts", "--body", "nope"],
      dir,
    );
    assert.match(missing, /no export named nope/);

    const both = renderSeed(
      ["--files", "src/multi.ts", "--body", "outer", "--callers", "outer"],
      dir,
    );
    assert.ok(
      both.includes("outer(x: number)") && both.includes("src/user.ts:1"),
      `both lookups compose:\n${both}`,
    );
  });
  console.log(
    "  ✓ review-seed --body slices declarations, --callers scans importers",
  );
}
