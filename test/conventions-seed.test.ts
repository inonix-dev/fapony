import { test } from "bun:test";
// test/conventions-seed.test.ts — PLAN-convention-debt chunk 2 (init fill-signal).
//
// Two sources, by design (SPEC §2.2): eslint no-restricted-* entries (they carry
// checker + the message a human wrote) and the wrapper detector (snapshot only —
// the base that works with zero history and zero eslint). A repo with neither
// still gets an empty conventions.json — never an error.

import assert from "node:assert";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedConventionsFile } from "../src/conventions-seed.js";

interface Row {
  id: string;
  rule: string;
  where: string;
  stale: string | null;
  checker: string | null;
}

/** seedConventionsFile is async — same fixture contract as helpers.withTempRepo. */
function withTempRepoAsync(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fapony-seed-")));
  return (async () => {
    try {
      execSync("git init", { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "README.md"), "# test repo\n");
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

interface Row {
  id: string;
  rule: string;
  where: string;
  stale: string | null;
  checker: string | null;
}

function readRows(repo: string): Row[] {
  const raw = JSON.parse(
    readFileSync(join(repo, ".fapony", "conventions.json"), "utf-8"),
  ) as { conventions: Row[] };
  return raw.conventions;
}

test("testSeedEslintEntriesCarryChecker", () => {
  withTempRepoAsync(async (repo) => {
    mkdirSync(join(repo, "apps/vela"), { recursive: true });
    writeFileSync(
      join(repo, "apps/vela/eslint.rules.js"),
      `const RHF = { name: "react-hook-form", message: "use useAppForm instead" };
const DATE_RULES = [
  { property: "toLocaleDateString", message: "use fmtDate from @/lib/bkk" },
];
export default [
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RHF] }],
      "no-restricted-properties": ["error", ...DATE_RULES],
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.name='useMutation']",
        message: "use wrappers",
      }],
    },
  },
];
`,
    );
    const result = await seedConventionsFile(repo);
    assert.equal(result.eslintRows, 3);
    assert.deepEqual(result.configs, [join("apps/vela", "eslint.rules.js")]);
    const rows = readRows(repo);
    const rhf = rows.find((r) => r.rule.includes("useAppForm"));
    assert.ok(rhf, "import entry lands");
    assert.equal(rhf.checker, "no-restricted-imports");
    assert.equal(rhf.where, "apps/vela/src");
    assert.equal(rhf.stale, `["']react-hook-form["']`);
    const date = rows.find((r) => r.rule.includes("fmtDate"));
    assert.equal(date?.stale, `\\.toLocaleDateString\\(`);
    // syntax selector is AST-shaped — no honest text regex, row still lands
    const syn = rows.find((r) => r.rule === "use wrappers");
    assert.equal(syn?.stale, null);
    assert.equal(syn?.checker, "no-restricted-syntax");
    // ids are unique even when messages repeat across blocks
    const ids = new Set(rows.map((r) => r.id));
    assert.equal(ids.size, rows.length);
  });
  console.log("  ✓ seed → eslint entries become conventions with checker");
});

test("testSeedEslintSupersetBlocksDedupe", () => {
  withTempRepoAsync(async (repo) => {
    writeFileSync(
      join(repo, "eslint.config.js"),
      `const RHF = { name: "react-hook-form", message: "no direct RHF" };
const SHEET = { name: "@innominix/ui", importNames: ["Sheet"], message: "no raw Sheet" };
export default [
  { files: ["src/**"], rules: { "no-restricted-imports": ["error", { paths: [RHF] }] } },
  { files: ["src/routes/**"], rules: { "no-restricted-imports": ["error", { paths: [RHF, SHEET] }] } },
];
`,
    );
    const result = await seedConventionsFile(repo);
    assert.equal(result.eslintRows, 2, "same message repeats = one row");
    const rows = readRows(repo);
    assert.equal(
      rows.filter((r) => r.rule === "no direct RHF").length,
      1,
      "superset blocks do not duplicate",
    );
  });
  console.log("  ✓ seed → superset blocks dedupe to one row per message");
});

test("testSeedWrapperDetectorFindsLiveMigrations", () => {
  withTempRepoAsync(async (repo) => {
    writeFileSync(
      join(repo, "id.ts"),
      `export const newId = (): string => crypto.randomUUID();\n`,
    );
    writeFileSync(
      join(repo, "money.ts"),
      `export const fmtMoney = (n: number): string => n.toLocaleString("th-TH");\n`,
    );
    const user = (i: number, body: string) =>
      writeFileSync(join(repo, `use${i}.ts`), body);
    user(1, `import { newId } from "./id";\nexport const a = () => newId();\n`);
    user(2, `import { newId } from "./id";\nexport const b = () => newId();\n`);
    user(3, `import { newId } from "./id";\nexport const c = () => newId();\n`);
    user(
      4,
      `import { fmtMoney } from "./money";\nexport const d = () => fmtMoney(1);\n`,
    );
    user(
      5,
      `import { fmtMoney } from "./money";\nexport const e = () => fmtMoney(2);\n`,
    );
    // still raw — the debt the convention exists for
    writeFileSync(
      join(repo, "raw1.ts"),
      `export const x = () => crypto.randomUUID();\n`,
    );
    writeFileSync(
      join(repo, "raw2.ts"),
      `export const y = () => crypto.randomUUID();\n`,
    );
    const result = await seedConventionsFile(repo);
    assert.ok(result.wrapperRows >= 1, "the live migration lands");
    const rows = readRows(repo);
    const wrap = rows.find((r) => r.id === "wrap-newid");
    assert.ok(wrap, "newId wrapper detected");
    assert.equal(wrap.stale, `\\.randomUUID\\(`);
    assert.equal(wrap.checker, null);
    assert.ok(wrap.rule.includes("2 file(s) still call it raw"));
    assert.ok(wrap.rule.includes("3 file(s) already use the wrapper"));
    // one-off wrappers (single user) never become rows
    writeFileSync(
      join(repo, "oneoff.ts"),
      `export const z = () => crypto.randomUUID();\n`,
    );
    assert.ok(!rows.some((r) => r.id === "wrap-z"));
  });
  console.log(
    "  ✓ seed → wrapper detector seeds stale+ok pairs, one-offs stay out",
  );
});

test("testSeedRepoWithoutAnythingGetsEmptyFile", () => {
  withTempRepoAsync(async (repo) => {
    const result = await seedConventionsFile(repo);
    assert.equal(result.eslintRows, 0);
    assert.equal(result.wrapperRows, 0);
    assert.ok(existsSync(result.file), "empty file still written");
    assert.deepEqual(readRows(repo), []);
  });
  console.log("  ✓ seed → a repo with no signal gets an empty file, no error");
});

test("testSeedNeverOverwritesExisting", () => {
  withTempRepoAsync(async (repo) => {
    mkdirSync(join(repo, ".fapony"), { recursive: true });
    writeFileSync(
      join(repo, ".fapony", "conventions.json"),
      `{"conventions":[{"id":"mine","rule":"hand-written","where":".","stale":"x","checker":null}]}`,
    );
    writeFileSync(
      join(repo, "eslint.config.js"),
      `export default [{ files: ["src/**"], rules: { "no-restricted-imports": ["error", { name: "lodash", message: "no lodash" }] } }];\n`,
    );
    const result = await seedConventionsFile(repo);
    assert.equal(result.kept, true);
    const rows = readRows(repo);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "mine");
  });
  console.log("  ✓ seed → existing conventions.json is never overwritten");
});

test("testSeedBrokenConfigIsSkippedLoudly", () => {
  withTempRepoAsync(async (repo) => {
    writeFileSync(
      join(repo, "eslint.config.js"),
      `export default [ { rules: { "no-restricted-syntax": ["error", { selector: "X", message: "m" }] } } ]\nthis is not valid javascript }{`,
    );
    const result = await seedConventionsFile(repo);
    assert.equal(result.eslintRows, 0);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0].includes("import failed"));
  });
  console.log("  ✓ seed → an unimportable config is skipped, said out loud");
});
