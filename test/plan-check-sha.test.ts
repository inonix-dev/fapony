import { test } from "bun:test";
// test/plan-check-sha.test.ts — chunks 8-9 (PLAN-seed-and-surface):
// plan-check verifies the commits ticked chunks cite; kickoff says whether
// the last ticked chunk actually closed. git is the judge in both.

import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkTickedLine, extractShas } from "../src/mem/commands/plan.js";
import { cmdKickoff } from "../src/mem/commands/read.js";
import { initStore } from "../src/mem/store.js";
import { captureLogs, withTempRepo } from "./helpers.js";

const FAPONY = join(import.meta.dir, "..", "fapony.ts");

const git = (dir: string, cmd: string): string =>
  execSync(`git ${cmd}`, { cwd: dir }).toString().trim();

// A repo with: HEAD commit (good), a side-branch commit (exists but never on
// HEAD), and HEAD's tree sha (an object, not a commit).
function repoWithShas(dir: string): {
  good: string;
  diverged: string;
  tree: string;
} {
  const base = git(dir, "branch --show-current");
  writeFileSync(join(dir, "a.txt"), "a\n");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "base"', { cwd: dir, stdio: "ignore" });
  const good = git(dir, "rev-parse --short=7 HEAD");
  const tree = git(dir, "rev-parse --short=7 HEAD^{tree}");
  execSync("git checkout -b side", { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "b.txt"), "b\n");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "side"', { cwd: dir, stdio: "ignore" });
  const diverged = git(dir, "rev-parse --short=7 HEAD");
  execSync(`git checkout ${base}`, { cwd: dir, stdio: "ignore" });
  return { good, diverged, tree };
}

test("testExtractShas", () => {
  assert.deepEqual(extractShas("- [x] chunk 1 — thing (abc1234)"), ["abc1234"]);
  assert.deepEqual(extractShas("- [x] chunk 1 — thing (abc1234 + def5678)"), [
    "abc1234",
    "def5678",
  ]);
  assert.deepEqual(extractShas("- [x] chunk 4 — defer, no commit"), []);
  // The regex catches hex words — git decides, not the regex.
  assert.deepEqual(extractShas("see deadbee below"), ["deadbee"]);
  // A 40-char sha never matches on its tail (git resolves leading prefixes).
  const full = "0123456789abcdef0123456789abcdef01234567";
  assert.deepEqual(extractShas(`cite ${full} here`), []);
  console.log("  ✓ extractShas finds standalone short shas only");
});

test("testCheckTickedLine", () => {
  withTempRepo((dir) => {
    const { good, diverged, tree } = repoWithShas(dir);
    assert.deepEqual(checkTickedLine(`- [x] chunk 1 — ok (${good})`, dir), {
      missing: [],
      diverged: [],
      cited: 1,
    });
    assert.deepEqual(
      checkTickedLine(`- [x] chunk 1 — tree, not commit (${tree})`, dir),
      { missing: [tree], diverged: [], cited: 1 },
    );
    assert.deepEqual(
      checkTickedLine(`- [x] chunk 1 — side branch (${diverged})`, dir),
      { missing: [], diverged: [diverged], cited: 1 },
    );
    // Hex words git never heard of are plain words, never issues.
    assert.deepEqual(
      checkTickedLine("- [x] chunk 4 — defer, see deadbee", dir),
      { missing: [], diverged: [], cited: 0 },
    );
    assert.deepEqual(checkTickedLine("- [x] chunk 4 — defer", dir), {
      missing: [],
      diverged: [],
      cited: 0,
    });
    // …unless cited next to a real sha: (deadbee + <known>) is a citation
    // of a commit git has no record of, not prose.
    assert.deepEqual(
      checkTickedLine(`- [x] chunk 1 — hooks (${good} + deadbee)`, dir),
      { missing: ["deadbee"], diverged: [], cited: 2 },
    );
    // Same line, outside the parens: still prose ("feedbac" in "feedback").
    assert.deepEqual(
      checkTickedLine(`- [x] chunk 1 — feedback on the cutover (${good})`, dir),
      { missing: [], diverged: [], cited: 1 },
    );
  });
  console.log("  ✓ checkTickedLine: ok / missing / diverged / plain-word");
});

// End to end through the real CLI: plan/ + done/ are both scanned, bad shas
// are named, hex words are not, and the summary counts the ratio.
test("testPlanCheckShaEndToEnd", () => {
  withTempRepo((dir) => {
    const { good, diverged, tree } = repoWithShas(dir);
    mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
    mkdirSync(join(dir, ".fapony", "done"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony/plan/PLAN-t.md"),
      `# T\n\n## TL;DR\n- [x] chunk 1 — good (${good})\n- [x] chunk 2 — tree, not commit (${tree})\n- [x] chunk 3 — side branch (${diverged})\n- [x] chunk 4 — defer, no commit\n- [x] chunk 5 — see deadbee\n- [x] chunk 6 — hooks (${good} + deadbee)\n- [x] chunk 7 — feedback on the cutover (${good})\n- [ ] chunk 8 — next\n`,
    );
    writeFileSync(
      join(dir, ".fapony/done/PLAN-old.md"),
      `# OLD\n\n## TL;DR\n- [x] chunk 1 — old but good (${good})\n`,
    );
    const proc = Bun.spawnSync(["bun", FAPONY, "mem", "plan-check"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString();
    const err = proc.stderr.toString();
    assert.equal(proc.exitCode, 1, `plan-check must fail:\n${out}\n${err}`);
    assert.match(err, new RegExp(tree), "names the non-commit object");
    assert.match(err, new RegExp(diverged), "names the diverged sha");
    assert.match(err, /cites deadbee/, "names the group-cited unknown sha");
    assert.equal(
      (err.match(/ticked chunk cites/g) ?? []).length,
      3,
      `exactly the 3 real citations fail, prose deadbee/feedback do not:\n${err}`,
    );
    assert.match(
      out,
      /closed chunks: 8 · citing a commit: 6 · verified: 3/,
      `summary counts the ratio:\n${out}`,
    );
  });
  console.log("  ✓ plan-check e2e: names bad shas, counts the ratio");
});

test("testPlanCheckShaClean", () => {
  withTempRepo((dir) => {
    const { good } = repoWithShas(dir);
    mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
    mkdirSync(join(dir, ".fapony", "done"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony/plan/PLAN-t.md"),
      `# T\n\n## TL;DR\n- [x] chunk 1 — good (${good})\n- [ ] chunk 2 — next\n`,
    );
    const proc = Bun.spawnSync(["bun", FAPONY, "mem", "plan-check"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString() + proc.stderr.toString();
    assert.equal(proc.exitCode, 0, `clean plan must pass:\n${out}`);
    assert.match(out, /✅ clean/);
  });
  console.log("  ✓ plan-check e2e: clean plan passes");
});

// Kickoff in-process (no spawn): the planFile branch prints one closure line
// — warn on missing/diverged/absent sha, silent when the sha verifies.
function kickoffOutput(dir: string, planBody: string): string {
  mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
  const plan = join(dir, ".fapony", "plan", "PLAN-t.md");
  writeFileSync(plan, planBody);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    initStore(dir);
    return captureLogs(() => cmdKickoff([plan]));
  } finally {
    process.chdir(prev);
  }
}

const planWith = (ticked: string): string =>
  `---\nkind: unit\n---\n\n# T\n\n## TL;DR\n${ticked}\n- [ ] chunk 9 — next\n`;

test("testKickoffClosureHint", () => {
  withTempRepo((dir) => {
    const { good, diverged, tree } = repoWithShas(dir);
    // Verified sha → silent.
    let out = kickoffOutput(dir, planWith(`- [x] chunk 8 — done (${good})`));
    assert.doesNotMatch(out, /⚠ chunk/, `verified sha stays silent:\n${out}`);
    assert.match(out, /chunk 9 — next/, "next chunk still shown");
    // No sha → warn.
    out = kickoffOutput(dir, planWith("- [x] chunk 8 — done, defer"));
    assert.match(
      out,
      /⚠ chunk 8 is ticked but cites no commit/,
      `sha-less chunk warns:\n${out}`,
    );
    // Non-commit object → warn.
    out = kickoffOutput(dir, planWith(`- [x] chunk 8 — done (${tree})`));
    assert.match(
      out,
      new RegExp(`⚠ chunk 8 is ticked but ${tree} is not in git`),
      `missing sha warns:\n${out}`,
    );
    // Diverged sha → warn.
    out = kickoffOutput(dir, planWith(`- [x] chunk 8 — done (${diverged})`));
    assert.match(
      out,
      new RegExp(`⚠ chunk 8 is ticked but ${diverged} is not on HEAD`),
      `diverged sha warns:\n${out}`,
    );
  });
  console.log("  ✓ kickoff: closure hint warns once, silent when verified");
});
