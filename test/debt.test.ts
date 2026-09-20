// test/debt.test.ts — PLAN-convention-debt chunk 1 (detector) + chunk 5 (promotion).
//
// The conventions.json lives in the measured repo — every fixture writes one.
// The done-criteria this file guards: deleting the stale line from a file
// makes the number drop by itself (derive, never store), checker rows are
// silent, a repo without conventions.json is silent (SPEC §6).

import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  debtForFile,
  debtScan,
  findPromotions,
  formatDebt,
  loadConventions,
  PROMOTION_THRESHOLD,
  resolveConventionsPath,
  worktreeOf,
} from "../src/debt/index.js";
import { withTempRepo, withTmpDb } from "./helpers.js";

function seed(
  repo: string,
  convs: unknown,
  files: Record<string, string>,
): void {
  mkdirSync(join(repo, ".fapony"), { recursive: true });
  writeFileSync(
    join(repo, ".fapony", "conventions.json"),
    `${JSON.stringify({ conventions: convs }, null, 2)}\n`,
  );
  for (const [p, body] of Object.entries(files)) {
    const abs = join(repo, p);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, body);
  }
}

export function testDebtSilentWithoutConventions(): void {
  withTempRepo((repo) => {
    const loaded = loadConventions(repo);
    assert.equal(loaded.path, null);
    assert.equal(loaded.convs.length, 0);
    const report = debtScan(repo, loaded);
    assert.equal(report.entries.length, 0);
    assert.match(formatDebt(report), /0 convention/);
  });
  console.log("  ✓ debt → no conventions.json stays silent, never errors");
}

export function testDebtDerivesListAndDropsWithTheFile(): void {
  withTempRepo((repo) => {
    seed(
      repo,
      [
        {
          id: "service-errors",
          rule: "use failWith instead of throw new Error",
          where: "src/server/services",
          stale: "throw new Error",
          ok: "failWith",
          guard: "extends Base",
        },
      ],
      {
        "src/server/services/a.ts": `export class A extends Base {}\nthrow new Error("x");\n`,
        "src/server/services/b.ts": `export class B extends Base {}\nfailWith("moved");\n`,
        "src/server/services/c.ts": `export class C {}\nthrow new Error("no Base — out of scope");\n`,
        "src/server/routes/r.ts": `export class R extends Base {}\nthrow new Error("outside where");\n`,
      },
    );
    const loaded = loadConventions(repo);
    assert.equal(loaded.convs.length, 1);
    const report = debtScan(repo, loaded);
    assert.equal(report.entries.length, 1);
    const e = report.entries[0];
    // guard + where both applied: only a.ts counts
    assert.deepEqual(e.files, ["src/server/services/a.ts"]);
    assert.equal(e.movedCount, 1);
    assert.ok(formatDebt(report).includes("debt 1"));
    assert.ok(formatDebt(report).includes("moved 1"));

    // Done criteria: delete the stale line → the number drops by itself
    writeFileSync(
      join(repo, "src/server/services/a.ts"),
      `export class A extends Base {}\nfailWith("migrated");\n`,
    );
    const after = debtScan(repo, loadConventions(repo));
    assert.equal(after.entries[0].files.length, 0);
  });
  console.log("  ✓ debt → derives from the repo, drops when a file migrates");
}

export function testDebtCheckerRowsStaySilent(): void {
  withTempRepo((repo) => {
    seed(
      repo,
      [
        {
          id: "form-lane",
          rule: "use useAppForm",
          where: "src",
          stale: 'from "react-hook-form"',
          checker: "pnpm lint:rules",
        },
        {
          id: "no-stale-yet",
          rule: "declared but stale not filled in",
          where: "src",
        },
        { id: "broken-regex", rule: "x", where: "src", stale: "(" },
        { id: "missing-where", rule: "x", where: "nowhere/", stale: "x" },
      ],
      { "src/a.ts": 'import x from "react-hook-form";\n' },
    );
    const report = debtScan(repo, loadConventions(repo));
    assert.equal(report.entries.length, 0, "checker row never scanned");
    assert.equal(report.checkedCount, 1);
    assert.equal(
      report.declared.length,
      1,
      "no-stale row surfaced for filling",
    );
    assert.equal(
      report.dropped.length,
      2,
      "broken regex + missing where dropped loudly",
    );
    assert.ok(report.dropped[0].reason.includes("stale regex broken"));
    assert.ok(report.dropped[1].reason.includes("does not exist"));
  });
  console.log("  ✓ debt → checker silent, declared surfaced, drops are loud");
}

export function testDebtTooBroadRegexDropped(): void {
  withTempRepo((repo) => {
    const files: Record<string, string> = {};
    // > DEBT_FILE_CAP (250) files matching a single letter — a repo-wide
    // "debt list" of this size is a broken regex, not a convention.
    for (let i = 0; i < 251; i++) files[`src/f${i}.ts`] = "const eh = 1;\n";
    seed(repo, [{ id: "wide", rule: "x", where: ".", stale: "e" }], files);
    const report = debtScan(repo, loadConventions(repo));
    assert.equal(report.entries.length, 0);
    assert.equal(report.dropped.length, 1);
    assert.ok(report.dropped[0].reason.includes("too broad"));
  });
  console.log(
    "  ✓ debt → a regex that matches the repo is dropped, not reported",
  );
}

export function testDebtForFileAndMonorepoResolution(): void {
  withTempRepo((repo) => {
    // monorepo shape: conventions live at <app>/.fapony/conventions.json —
    // the walk-up resolver finds <app>/.fapony/.memory/ from within the app
    try {
      // Create .fapony/.memory/ with a dummy log at each app level
      mkdirSync(join(repo, "apps/shop/.fapony/.memory"), { recursive: true });
      mkdirSync(join(repo, "apps/other/.fapony/.memory"), { recursive: true });
      mkdirSync(join(repo, "apps/shop/src"), { recursive: true });
      writeFileSync(join(repo, "apps/shop/.fapony/.memory/log.jsonl"), "");
      writeFileSync(join(repo, "apps/other/.fapony/.memory/log.jsonl"), "");
      writeFileSync(
        join(repo, "apps/shop/.fapony/conventions.json"),
        JSON.stringify({
          conventions: [
            {
              id: "money-format",
              rule: "no bare toLocaleString",
              where: "apps/shop/src",
              stale: "toLocaleString\\(\\)",
            },
          ],
        }),
      );
      writeFileSync(
        join(repo, "apps/other/.fapony/conventions.json"),
        JSON.stringify({
          conventions: [{ id: "other", rule: "r", where: ".", stale: "zzz" }],
        }),
      );
      writeFileSync(
        join(repo, "apps/shop/src/money.ts"),
        "export const x = n.toLocaleString();\n",
      );
      // loadConventions from within the app → walk-up finds apps/shop/.fapony/.memory/
      const loaded = loadConventions(join(repo, "apps/shop/src"));
      // debtForFile needs repo root as worktree for relative path calculation
      const hit = debtForFile(
        repo,
        join(repo, "apps/shop/src/money.ts"),
        loaded,
      );
      assert.deepEqual(
        hit.map((c) => c.id),
        ["money-format"],
      );
      const miss = debtForFile(
        repo,
        join(repo, "apps/shop/src/other.ts"),
        loaded,
      );
      assert.equal(miss.length, 0);
    } finally {
      // cleanup not needed — withTempRepo handles it
    }
  });
  console.log(
    "  ✓ debt → app-level conventions.json wins via walk-up resolver",
  );
}

export function testDebtPromotionAsksAtThresholdOnly(): void {
  withTempRepo((repo) => {
    seed(
      repo,
      [
        {
          id: "money-format",
          rule: "no bare toLocaleString",
          where: "src",
          stale: "toLocaleString\\(\\)",
          ok: "fmtMoney",
        },
        {
          id: "settled",
          rule: "x",
          where: "src",
          stale: "zz",
          decided: "no-checker",
        },
      ],
      { "src/a.ts": "n.toLocaleString();\n" },
    );
    const report = debtScan(repo, loadConventions(repo));
    const rows = (ts: string, kind: string, text: string, files?: string[]) =>
      JSON.stringify({
        ts,
        agent: "t",
        kind,
        text,
        ...(files ? { files } : {}),
      });
    mkdirSync(join(repo, ".fapony", ".memory"), { recursive: true });
    const memLog = join(repo, ".fapony", ".memory", "log.test.jsonl");
    const two = [
      rows("2026-08-30T00:00:00Z", "bug", "money wrong via toLocaleString"),
      rows(
        "2026-09-12T00:00:00Z",
        "decision",
        "fmtMoney for all money display",
      ),
    ];
    const three = [
      ...two,
      rows("2026-09-17T00:00:00Z", "bug", "bare toLocaleString drifted again"),
    ];
    const run = (lines: string[]) => {
      writeFileSync(memLog, `${lines.join("\n")}\n`);
      return findPromotions(repo, report);
    };
    assert.equal(run(two).length, 0, "below threshold stays silent");
    const ps = run(three);
    assert.equal(ps.length, 1);
    assert.equal(ps[0].convId, "money-format");
    assert.equal(ps[0].occurrences, 3);
    assert.ok(ps[0].dates.join(",").includes("2026-09-17"));
    // settled (decided) never appears even though its regex would match nothing anyway
    assert.ok(!ps.some((p) => p.convId === "settled"));
  });
  console.log(
    `  ✓ debt → promotion asks at ${PROMOTION_THRESHOLD}×, decided:no-checker stays silent`,
  );
}

export function testDebtPromotionCountsLedgerFails(): void {
  withTempRepo((repo) => {
    seed(
      repo,
      [
        {
          id: "money-format",
          rule: "money",
          where: "src",
          stale: "toLocaleString",
        },
      ],
      { "src/a.ts": "n.toLocaleString();\n" },
    );
    const report = debtScan(repo, loadConventions(repo));
    mkdirSync(join(repo, ".fapony", ".memory"), { recursive: true });
    writeFileSync(join(repo, ".fapony", ".memory", "log.test.jsonl"), "");
    withTmpDb((db) => {
      const newRun = (id: number, wt: string) =>
        db
          .prepare(
            `INSERT INTO runs (id, worktree, plan, mem_id, status) VALUES (?, ?, NULL, NULL, 'passed')`,
          )
          .run(id, wt);
      const gate = (id: number, data: object) =>
        db
          .prepare(
            `INSERT INTO events (run_id, kind, data) VALUES (?, 'gate', ?)`,
          )
          .run(id, JSON.stringify(data));
      newRun(1, repo);
      newRun(2, "/elsewhere");
      gate(1, { verdict: "fail", note: "money drifted", files: ["src/a.ts"] });
      gate(1, {
        reason_code: "scope_mismatch",
        note: "money again",
        files: ["src/a.ts"],
      });
      gate(2, {
        verdict: "fail",
        note: "money elsewhere",
        files: ["src/other.ts"],
      });
      const ps = findPromotions(repo, report);
      assert.equal(ps.length, 0, "2 hits in this worktree < threshold");
      gate(1, {
        reason_code: "spec_gap",
        note: "money third time",
        files: ["src/a.ts"],
      });
      const ps3 = findPromotions(repo, report);
      assert.equal(ps3.length, 1, "third hit crosses the threshold");
      assert.equal(ps3[0].occurrences, 3);
    });
  });
  console.log("  ✓ debt → fail verdicts on the same files count as recurrence");
}

export function testDebtConventionsPathResolution(): void {
  withTempRepo((repo) => {
    assert.equal(resolveConventionsPath(repo), null);
    mkdirSync(join(repo, ".fapony"), { recursive: true });
    writeFileSync(join(repo, ".fapony", "conventions.json"), "{}");
    assert.ok(
      resolveConventionsPath(repo)?.endsWith(".fapony/conventions.json"),
    );
  });
  console.log("  ✓ debt → conventions.json resolves at the repo root fallback");
}

/**
 * The monorepo root has no conventions.json and two apps have one each. Before
 * this, `debt` resolved the worktree with `git rev-parse --show-toplevel` and
 * ignored the path it was given, so `fapony debt apps/shop` measured the root,
 * the mem resolver went ambiguous, and it reported "nothing tracked yet".
 */
export function testDebtWorktreeFollowsThePathNotGitRoot(): void {
  withTempRepo((repo) => {
    mkdirSync(join(repo, "apps/shop/.fapony"), { recursive: true });
    mkdirSync(join(repo, "apps/shop/src"), { recursive: true });
    mkdirSync(join(repo, "apps/other/.fapony"), { recursive: true });
    const conv = JSON.stringify({
      conventions: [{ id: "c", rule: "r", where: ".", stale: "zzz" }],
    });
    writeFileSync(join(repo, "apps/shop/.fapony/conventions.json"), conv);
    writeFileSync(join(repo, "apps/other/.fapony/conventions.json"), conv);

    assert.equal(worktreeOf(join(repo, "apps/shop")), join(repo, "apps/shop"));
    // from a subdir of the app too — the walk stops at the app, not the root
    assert.equal(
      worktreeOf(join(repo, "apps/shop/src")),
      join(repo, "apps/shop"),
    );
    // nothing to find above the root → git root, same as before
    assert.equal(
      loadConventions(worktreeOf(join(repo, "apps/shop"))).convs.length,
      1,
    );
    assert.equal(loadConventions(worktreeOf(repo)).path, null);
  });
  console.log("  ✓ debt → worktree follows the given path, not the git root");
}
