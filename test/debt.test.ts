import { test } from "bun:test";
// test/debt.test.ts — PLAN-convention-debt chunk 1 (detector) + chunk 5 (promotion).
//
// The conventions.json lives in the measured repo — every fixture writes one.
// The done-criteria this file guards: deleting the stale line from a file
// makes the number drop by itself (derive, never store), checker rows are
// silent, a repo without conventions.json is silent (SPEC §6).

import assert from "node:assert";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cmdDebt,
  debtForFile,
  debtScan,
  findPromotions,
  formatDebt,
  loadConventions,
  PROMOTION_THRESHOLD,
  resolveConventionsPath,
  resolveDebtScope,
  worktreeOf,
} from "../src/debt/index.js";
import {
  captureLogs,
  type FaelFixtureRow,
  withFakeFael,
  withTempRepo,
  withTmpDb,
} from "./helpers.js";

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

test("testDebtSilentWithoutConventions", () => {
  withTempRepo((repo) => {
    const loaded = loadConventions(repo);
    assert.equal(loaded.path, null);
    assert.equal(loaded.convs.length, 0);
    const report = debtScan(repo, loaded);
    assert.equal(report.entries.length, 0);
    assert.match(formatDebt(report), /0 convention/);
  });
  console.log("  ✓ debt → no conventions.json stays silent, never errors");
});

test("testDebtDerivesListAndDropsWithTheFile", () => {
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
});

test("testDebtIdCommaList", () => {
  // `--id a,b` compared as ONE literal id → silent 0 rows, the same
  // typo-vs-empty shape as a wrong subcommand (PLAN-comma-x).
  withTempRepo((repo) => {
    seed(
      repo,
      [
        {
          id: "service-errors",
          rule: "use failWith instead of throw new Error",
          where: "src",
          stale: "throw new Error",
          ok: "failWith",
        },
        {
          id: "money-format",
          rule: "use formatMoney instead of toFixed",
          where: "src",
          stale: "toFixed",
          ok: "formatMoney",
        },
      ],
      {
        "src/a.ts": `throw new Error("x");\ntoFixed(2);\n`,
      },
    );
    const ids = (args: string[]): string[] =>
      withTmpDb(() => {
        const out = captureLogs(() => cmdDebt(args));
        return JSON.parse(out).entries.map(
          (e: { conv: { id: string } }) => e.conv.id,
        ) as string[];
      });
    assert.deepEqual(ids([repo, "--id", "service-errors", "--json"]), [
      "service-errors",
    ]);
    assert.deepEqual(
      ids([repo, "--id", "service-errors,money-format", "--json"]),
      ["service-errors", "money-format"],
      "comma list keeps every named id",
    );
    assert.deepEqual(
      ids([repo, "--id", "money-format,nonexistent", "--json"]),
      ["money-format"],
      "unknown names drop silently; known ones survive",
    );
  });
  console.log("  ✓ debt --id accepts comma lists");
});

// PLAN-comma-x chunk 2 — repeated list flags accumulate, never last-win
// (`--id a --id b` used to keep only b; same for --files).
test("testDebtRepeatedFlagsAccumulate", () => {
  withTempRepo((repo) => {
    seed(
      repo,
      [
        {
          id: "service-errors",
          rule: "use failWith instead of throw new Error",
          where: "src",
          stale: "throw new Error",
          ok: "failWith",
        },
        {
          id: "money-format",
          rule: "use formatMoney instead of toFixed",
          where: "src",
          stale: "toFixed",
          ok: "formatMoney",
        },
      ],
      {
        "src/a.ts": `throw new Error("x");\n`,
        "src/b.ts": `toFixed(2);\n`,
      },
    );
    const json = <T>(args: string[]): T =>
      withTmpDb(() => JSON.parse(captureLogs(() => cmdDebt(args)))) as T;

    // repeated --id: both named conventions survive
    const ids = json<{ entries: { conv: { id: string } }[] }>([
      repo,
      "--id",
      "service-errors",
      "--id",
      "money-format",
      "--json",
    ]).entries.map((e) => e.conv.id);
    assert.deepEqual(ids, ["service-errors", "money-format"]);

    // comma form + repeat compose
    const mixed = json<{ entries: { conv: { id: string } }[] }>([
      repo,
      "--id",
      "service-errors",
      "--id",
      "money-format,nonexistent",
      "--json",
    ]).entries.map((e) => e.conv.id);
    assert.deepEqual(mixed, ["service-errors", "money-format"]);

    // repeated --files: both files in the files-mode report
    const filesOut = json<{ files: { file: string }[] }>([
      repo,
      "--files",
      "src/a.ts",
      "--files",
      "src/b.ts",
      "--json",
    ]);
    assert.deepEqual(
      filesOut.files.map((f) => f.file),
      ["src/a.ts", "src/b.ts"],
    );
  });
  console.log("  ✓ debt repeated --id/--files accumulate, never last-win");
});

test("testDebtCheckerRowsStaySilent", () => {
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
});

test("testDebtTooBroadRegexDropped", () => {
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
});

test("testDebtForFileAndMonorepoResolution", () => {
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
});

test("testDebtPromotionAsksAtThresholdOnly", () => {
  withFakeFael((setRows) =>
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
      const rows = (
        ts: string,
        kind: string,
        text: string,
      ): FaelFixtureRow => ({
        id: ts,
        ts,
        kind,
        text,
      });
      const two = [
        rows("2026-08-30T00:00:00Z", "issue", "money wrong via toLocaleString"),
        rows(
          "2026-09-12T00:00:00Z",
          "decision",
          "fmtMoney for all money display",
        ),
      ];
      const three = [
        ...two,
        rows(
          "2026-09-17T00:00:00Z",
          "issue",
          "bare toLocaleString drifted again",
        ),
      ];
      const run = (fixture: FaelFixtureRow[]) => {
        setRows(fixture);
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
    }),
  );
  console.log(
    `  ✓ debt → promotion asks at ${PROMOTION_THRESHOLD}×, decided:no-checker stays silent`,
  );
});

test("testDebtPromotionCountsLedgerFails", () => {
  // empty fael log — only ledger fails count here
  withFakeFael(() =>
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
        gate(1, {
          verdict: "fail",
          note: "money drifted",
          files: ["src/a.ts"],
        });
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
    }),
  );
  console.log("  ✓ debt → fail verdicts on the same files count as recurrence");
});

test("testDebtConventionsPathResolution", () => {
  withTempRepo((repo) => {
    assert.equal(resolveConventionsPath(repo), null);
    mkdirSync(join(repo, ".fapony"), { recursive: true });
    writeFileSync(join(repo, ".fapony", "conventions.json"), "{}");
    assert.ok(
      resolveConventionsPath(repo)?.endsWith(".fapony/conventions.json"),
    );
  });
  console.log("  ✓ debt → conventions.json resolves at the repo root fallback");
});

/**
 * The monorepo root has no conventions.json and two apps have one each. Before
 * this, `debt` resolved the worktree with `git rev-parse --show-toplevel` and
 * ignored the path it was given, so `fapony debt apps/shop` measured the root,
 * the mem resolver went ambiguous, and it reported "nothing tracked yet".
 */
test("testDebtWorktreeFollowsThePathNotGitRoot", () => {
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
});

/**
 * Bugs mucvfaxk + mucvfiv5: one app-scoped conventions file (the vela
 * shape), repo-relative `where`. The scope pairs a repo-root scan with the
 * nearest — or, outside any app dir, the lone — conventions file.
 */
test("testDebtScopePairsRootScanWithNearestOrLoneConventions", () => {
  withTempRepo((repo) => {
    const root = realpathSync(repo);
    mkdirSync(join(repo, "apps/shop/.fapony"), { recursive: true });
    mkdirSync(join(repo, "apps/shop/src"), { recursive: true });
    mkdirSync(join(repo, "packages/lib"), { recursive: true });
    writeFileSync(
      join(repo, "apps/shop/.fapony/conventions.json"),
      JSON.stringify({
        conventions: [
          {
            id: "shop-only",
            rule: "r",
            where: "apps/shop/src",
            stale: "toLocaleString\\(\\)",
          },
          {
            id: "shared",
            rule: "r",
            where: ".",
            stale: "throw new Error",
            guard: "extends Base",
          },
        ],
      }),
    );
    writeFileSync(
      join(repo, "apps/shop/src/money.ts"),
      "export const x = n.toLocaleString();\n",
    );
    writeFileSync(
      join(repo, "packages/lib/svc.ts"),
      'export class S extends Base { m() { throw new Error("x"); } }\n',
    );

    // From inside the app: walk-up finds the app file, scan root is the repo.
    const inApp = resolveDebtScope(join(repo, "apps/shop/src"));
    assert.equal(inApp.scanRoot, root);
    assert.deepEqual(inApp.loaded.convs.map((c) => c.id).sort(), [
      "shared",
      "shop-only",
    ]);
    assert.deepEqual(
      debtForFile(
        inApp.scanRoot,
        join(root, "apps/shop/src/money.ts"),
        inApp.loaded,
      ).map((c) => c.id),
      ["shop-only"],
    );

    // From outside any app dir: the lone-file fallback finds the same file
    // (this is the packages/storage.ts case the plain walk-up misses).
    const inPkg = resolveDebtScope(join(repo, "packages/lib"));
    assert.equal(inPkg.scanRoot, root);
    assert.deepEqual(inPkg.loaded.convs.map((c) => c.id).sort(), [
      "shared",
      "shop-only",
    ]);
    assert.deepEqual(
      debtForFile(
        inPkg.scanRoot,
        join(root, "packages/lib/svc.ts"),
        inPkg.loaded,
      ).map((c) => c.id),
      ["shared"],
    );

    // From the root itself (the mucvfiv5 CLI case): same fallback, full scan.
    const atRoot = resolveDebtScope(repo);
    assert.equal(atRoot.scanRoot, root);
    assert.equal(atRoot.loaded.convs.length, 2);
    const report = debtScan(atRoot.scanRoot, atRoot.loaded);
    assert.deepEqual(
      report.entries.find((e) => e.conv.id === "shop-only")?.files,
      ["apps/shop/src/money.ts"],
    );
    assert.deepEqual(
      report.entries.find((e) => e.conv.id === "shared")?.files,
      ["packages/lib/svc.ts"],
    );
  });
  console.log(
    "  ✓ debt → scope pairs repo-root scan with nearest (or lone) conventions",
  );
});

test("testDebtScopeStaysAmbiguousWithTwoConventionsFiles", () => {
  withTempRepo((repo) => {
    const root = realpathSync(repo);
    mkdirSync(join(repo, "apps/a/.fapony"), { recursive: true });
    mkdirSync(join(repo, "apps/b/.fapony"), { recursive: true });
    const conv = JSON.stringify({
      conventions: [{ id: "c", rule: "r", where: ".", stale: "zzz" }],
    });
    writeFileSync(join(repo, "apps/a/.fapony/conventions.json"), conv);
    writeFileSync(join(repo, "apps/b/.fapony/conventions.json"), conv);
    // From the root: two files → don't guess.
    const atRoot = resolveDebtScope(repo);
    assert.equal(atRoot.scanRoot, root);
    assert.equal(atRoot.loaded.path, null);
    // From inside an app: walk-up is still deterministic.
    const inApp = resolveDebtScope(join(repo, "apps/a"));
    assert.equal(inApp.loaded.convs.length, 1);
  });
  console.log(
    "  ✓ debt → two conventions files stay ambiguous, app walk-up still wins",
  );
});
