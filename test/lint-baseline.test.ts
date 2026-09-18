// test/lint-baseline.test.ts — PLAN-convention-debt chunk 6.
//
// "แดงนี่ของใคร" — the baseline captures pre-existing `path:rule-id` pairs and
// --diff reports only what this work added. An agent that did nothing wrong
// must see 0 when the repo was already red. Not state.db — a temp file under
// the state dir, discarded after the diff (SPEC §4).

import assert from "node:assert";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempRepo } from "./helpers.js";

const FAPONY = join(import.meta.dir, "..", "fapony.ts");

interface Out {
  status: number;
  stdout: string;
  stderr: string;
}

function run(dir: string, args: string[], stateDir: string): Out {
  const p = Bun.spawnSync(["bun", FAPONY, "lint-baseline", ...args], {
    cwd: dir,
    env: { ...process.env, FAPONY_STATE_DIR: stateDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: p.exitCode ?? 0,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
  };
}

const JSON_LINTER = `
import { readFileSync } from "node:fs";
import { join } from "node:path";
const findings = JSON.parse(readFileSync(join(process.cwd(), ".lint-current.json"), "utf8"));
console.log(JSON.stringify(findings.map((f) => ({
  filePath: join(process.cwd(), f.file),
  messages: (f.rules ?? []).map((ruleId) => ({ ruleId, line: 1, column: 1 })),
}))));
`;

function commit(dir: string): void {
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync("git commit -m lint --allow-empty", { cwd: dir, stdio: "ignore" });
}

function setCurrent(dir: string, findings: object[]): void {
  writeFileSync(join(dir, ".lint-current.json"), JSON.stringify(findings));
}

function stateBaseline(stateDir: string): string | null {
  const d = join(stateDir, "lint-baseline");
  if (!existsSync(d)) return null;
  const files = readdirSync(d);
  return files.length > 0 ? join(d, files[0]) : null;
}

export function testLintBaselineCaptureAndCleanDiff(): void {
  withTempRepo((dir) => {
    const stateDir = join(dir, ".state");
    writeFileSync(join(dir, "lint-out.ts"), JSON_LINTER);
    setCurrent(dir, [
      { file: "src/a.ts", rules: ["no-var", "import/order"] },
      { file: "src/b.ts", rules: ["no-var"] },
    ]);
    commit(dir);

    const cap = run(dir, ["--capture", "--cmd", "bun lint-out.ts"], stateDir);
    assert.equal(cap.status, 0, cap.stderr);
    assert.match(cap.stdout, /captured 3 finding\(s\) \(eslint-json\)/);
    const base = stateBaseline(stateDir);
    assert.ok(base, "baseline file lives under the state dir, not state.db");
    const parsed = JSON.parse(readFileSync(base as string, "utf-8")) as {
      pairs: string[];
      baseSha: string;
    };
    assert.deepEqual(parsed.pairs, [
      "src/a.ts:import/order",
      "src/a.ts:no-var",
      "src/b.ts:no-var",
    ]);
    assert.ok(parsed.baseSha !== "none" && parsed.baseSha !== "");

    // same lint output → 0 new findings, baseline discarded after the diff
    const diff = run(dir, ["--diff", "--cmd", "bun lint-out.ts"], stateDir);
    assert.equal(diff.status, 0, diff.stderr);
    assert.match(diff.stdout, /new findings introduced by this work: 0/);
    assert.equal(stateBaseline(stateDir), null, "baseline is temporary");
  });
  console.log(
    "  ✓ lint-baseline → capture stores pairs, clean diff sees 0 and discards",
  );
}

export function testLintBaselineDiffReportsOnlyNewFindings(): void {
  withTempRepo((dir) => {
    const stateDir = join(dir, ".state");
    writeFileSync(join(dir, "lint-out.ts"), JSON_LINTER);
    setCurrent(dir, [{ file: "src/a.ts", rules: ["no-var"] }]);
    commit(dir);
    run(dir, ["--capture", "--cmd", "bun lint-out.ts"], stateDir);
    // the agent's work added findings and fixed the pre-existing one
    setCurrent(dir, [
      { file: "src/a.ts", rules: ["no-new-rule"] },
      { file: "src/c.ts", rules: ["fresh/one"] },
    ]);
    const diff = run(dir, ["--diff", "--cmd", "bun lint-out.ts"], stateDir);
    assert.match(diff.stdout, /new findings introduced by this work: 2/);
    assert.match(diff.stdout, /src\/a\.ts:no-new-rule/);
    assert.match(diff.stdout, /src\/c\.ts:fresh\/one/);
    assert.match(diff.stdout, /fixed 1 pre-existing/);
  });
  console.log("  ✓ lint-baseline → diff reports only what this work added");
}

export function testLintBaselineUnixFormatAndErrors(): void {
  withTempRepo((dir) => {
    const stateDir = join(dir, ".state");
    writeFileSync(
      join(dir, "lint-unix.ts"),
      `console.log("src/a.ts:12:5: Unexpected var. (no-var)\\nsrc/b.ts:3:1: oops (fancy/rule)")`,
    );
    const cap = run(dir, ["--capture", "--cmd", "bun lint-unix.ts"], stateDir);
    assert.match(cap.stdout, /captured 2 finding\(s\) \(unix-lines\)/);
    const parsed = JSON.parse(
      readFileSync(stateBaseline(stateDir) as string, "utf-8"),
    ) as { pairs: string[] };
    assert.ok(parsed.pairs.includes("src/a.ts:no-var"));
    // a successful diff discards the baseline — a second diff must say so
    const first = run(dir, ["--diff", "--cmd", "bun lint-unix.ts"], stateDir);
    assert.equal(first.status, 0, first.stderr);
    const second = run(dir, ["--diff", "--cmd", "bun lint-unix.ts"], stateDir);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /no baseline captured/);
  });
  console.log(
    "  ✓ lint-baseline → unix-line parser works, diff without capture errors",
  );
}
