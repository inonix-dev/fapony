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
    // --files = pass-through, marked as given
    const files = renderSeed(["--files", "src/b.ts,missing.ts"], dir);
    assert.match(files, /--files \(as given\)/);
    assert.match(files, /missing\.ts \(as given\)/);
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
