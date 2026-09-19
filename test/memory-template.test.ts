// test/memory-template.test.ts — path resolution inside templates/mem/store.ts.
//
// store.ts resolves planDir/doneDir at import time from git root + its own location +
// fapony.config.json, so it can only be exercised by importing it inside a real fixture
// repo. Each case spawns bun once and reads the exported paths back as JSON.
//
// This is the file to add to when a layout bug shows up: every case below is a repo shape
// that broke at some point (a monorepo app writing into another app's log, plan-sweep
// looking for plans that were never there, config inherited across project boundaries).

import assert from "node:assert";
import { execSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMPLATE = join(import.meta.dir, "..", "templates", "mem");

type Paths = { dir: string; plan: string; done: string };

/** Import store.ts from a fixture repo and read back what it resolved. */
function resolve(repo: string, storeDir: string, app?: string): Paths {
  const out = execSync(
    `bun -e 'const s = await import(process.env.S); console.log(JSON.stringify({dir: s.dir, plan: s.planDir, done: s.doneDir}))'`,
    {
      cwd: repo,
      env: { ...process.env, S: join(storeDir, "store.ts"), MEM_APP: app },
      encoding: "utf8",
    },
  );
  return JSON.parse(out.trim().split("\n").at(-1) as string) as Paths;
}

function withFixture(
  build: (repo: string) => void,
  fn: (repo: string) => void,
): void {
  // realpath: macOS puts tmpdir behind /var -> /private/var, and `git rev-parse
  // --show-toplevel` (what store.ts uses for root) reports the resolved form.
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fapony-memtpl-")));
  try {
    execSync("git init", { cwd: repo, stdio: "ignore" });
    build(repo);
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

/** Central copy at the repo root, one log per app — the vela shape. */
function centralCopy(repo: string, config?: object): string {
  const memDir = join(repo, ".memory");
  cpSync(TEMPLATE, memDir, { recursive: true });
  if (config)
    writeFileSync(
      join(repo, "fapony.config.json"),
      JSON.stringify({ paths: { memoryEntry: ".memory/mem.ts", ...config } }),
    );
  return memDir;
}

export function testMemTemplateMonorepoMigratedApp(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela/.fapony/plan"), { recursive: true });
      // โฟลเดอร์ .memory ว่างเปล่า (ไม่มี log.jsonl) ต้องไม่ล็อกไว้กับ layout เก่า —
      // fallback เช็ค log.jsonl ไม่ใช่ dir
      mkdirSync(join(repo, "apps/vela/.memory"), { recursive: true });
      centralCopy(repo, {});
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"), "vela");
      assert.equal(p.plan, join(repo, "apps/vela/.fapony/plan"));
      assert.equal(p.done, join(repo, "apps/vela/.fapony/done"));
      assert.equal(p.dir, join(repo, "apps/vela/.fapony/.memory"));
    },
  );
  console.log("  ✓ memory template → app migrated into .fapony/ uses it");
}

// Repo ที่ยังไม่ย้าย (มี log เก่าอยู่จริง) ต้องอ่าน/เขียนที่เดิมต่อ — ไม่สร้าง log ใหม่เงียบๆ
export function testMemTemplateMonorepoLegacyLog(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela/.fapony/plan"), { recursive: true });
      mkdirSync(join(repo, "apps/vela/.memory"), { recursive: true });
      writeFileSync(join(repo, "apps/vela/.memory/log.jsonl"), "");
      centralCopy(repo, {});
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"), "vela");
      assert.equal(p.dir, join(repo, "apps/vela/.memory"));
    },
  );
  console.log(
    "  ✓ memory template → monorepo with legacy log.jsonl keeps .memory/",
  );
}

// Repo เดี่ยว: สำเนากลางที่ .memory/ เดิมซึ่งยังไม่มี log ต้องชี้ไป .fapony/.memory ที่เป็น default ใหม่
export function testMemTemplateSingleRepoCentralDefaultsToFapony(): void {
  withFixture(
    (repo) => {
      centralCopy(repo);
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"));
      assert.equal(p.dir, join(repo, ".fapony/.memory"));
    },
  );
  console.log(
    "  ✓ memory template → single-repo central copy without legacy log uses .fapony/.memory",
  );
}

// Repo เดี่ยว legacy: มี log เก่าที่ .memory/ ต้องเขียนที่เดิมต่อ
export function testMemTemplateSingleRepoLegacyLog(): void {
  withFixture(
    (repo) => {
      const memDir = centralCopy(repo);
      writeFileSync(join(memDir, "log.jsonl"), "");
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"));
      assert.equal(p.dir, join(repo, ".memory"));
    },
  );
  console.log(
    "  ✓ memory template → single repo with legacy log.jsonl keeps .memory/",
  );
}

// Monorepo ที่วาง app ใต้ packages/ (ไม่ใช่ apps/) ต้อง resolve ไป packages/<app>/.fapony/…
export function testMemTemplatePackagesApp(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "packages/shop/.fapony/plan"), { recursive: true });
      centralCopy(repo, {});
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"), "shop");
      assert.equal(p.dir, join(repo, "packages/shop/.fapony/.memory"));
      assert.equal(p.plan, join(repo, "packages/shop/.fapony/plan"));
    },
  );
  console.log("  ✓ memory template → app under packages/ resolves into it");
}

// Repo เดี่ยวที่มี packages/ (ไลบรารี ไม่ใช่ app) ต้องใช้ root เหมือนเดิม ไม่ error
export function testMemTemplateSingleRepoWithPackagesDir(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "packages/utils"), { recursive: true });
      centralCopy(repo);
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"));
      assert.equal(p.dir, join(repo, ".fapony/.memory"));
    },
  );
  console.log(
    "  ✓ memory template → single repo with a packages/ dir still uses the root",
  );
}

// The regression this guards: paths.planDir is single-valued, so declaring it for one app
// pointed every other app in the monorepo at that app's plans. Deriving the default from
// each app's own tree lets them migrate one at a time.
export function testMemTemplateMonorepoUnmigratedApp(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela/.fapony/plan"), { recursive: true });
      mkdirSync(join(repo, "apps/canalis/plan/done"), { recursive: true });
      centralCopy(repo, {});
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"), "canalis");
      assert.equal(p.plan, join(repo, "apps/canalis/plan"));
      assert.equal(p.done, join(repo, "apps/canalis/plan/done"));
    },
  );
  console.log(
    "  ✓ memory template → unmigrated app keeps plan/ and plan/done/",
  );
}

export function testMemTemplateConfigStillWins(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela/.fapony/plan"), { recursive: true });
      mkdirSync(join(repo, "apps/vela/plan/done"), { recursive: true });
      centralCopy(repo, { planDir: "apps/vela/plan" });
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"), "vela");
      assert.equal(p.plan, join(repo, "apps/vela/plan"));
      assert.equal(p.done, join(repo, "apps/vela/plan/done"));
    },
  );
  console.log(
    "  ✓ memory template → declared planDir beats the .fapony/ default",
  );
}

// The central copy (vela's shape) moved from `.memory/` into `.fapony/.memory/` at the
// monorepo root — must keep splitting by app, not collapse into "own folder" like a real
// scaffolded copy would (that's apps/<x>/.fapony/.memory/, a different path shape below).
export function testMemTemplateCentralCopyMovedIntoFapony(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela/.fapony/plan"), { recursive: true });
      mkdirSync(join(repo, "apps/vela/.memory"), { recursive: true });
      cpSync(TEMPLATE, join(repo, ".fapony/.memory"), { recursive: true });
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".fapony/.memory"), "vela");
      assert.equal(p.dir, join(repo, "apps/vela/.fapony/.memory"));
      assert.equal(p.plan, join(repo, "apps/vela/.fapony/plan"));
    },
  );
  console.log(
    "  ✓ memory template → central copy moved into root .fapony/.memory still splits by app",
  );
}

export function testMemTemplateScaffolded(): void {
  withFixture(
    (repo) => {
      cpSync(TEMPLATE, join(repo, ".fapony/.memory"), { recursive: true });
      mkdirSync(join(repo, ".fapony/plan"), { recursive: true });
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".fapony/.memory"));
      assert.equal(p.dir, join(repo, ".fapony/.memory"));
      assert.equal(p.plan, join(repo, ".fapony/plan"));
      assert.equal(p.done, join(repo, ".fapony/done"));
    },
  );
  console.log(
    "  ✓ memory template → `fapony init` scaffold stays self-relative",
  );
}

// A copy scaffolded inside one app must not read the monorepo root's config: that config
// describes a different project's paths.
export function testMemTemplateScaffoldedIgnoresRootConfig(): void {
  withFixture(
    (repo) => {
      cpSync(TEMPLATE, join(repo, "apps/falsify/.fapony/.memory"), {
        recursive: true,
      });
      mkdirSync(join(repo, "apps/vela"), { recursive: true });
      writeFileSync(
        join(repo, "fapony.config.json"),
        JSON.stringify({ paths: { planDir: "apps/vela/plan" } }),
      );
    },
    (repo) => {
      const p = resolve(repo, join(repo, "apps/falsify/.fapony/.memory"));
      assert.equal(p.plan, join(repo, "apps/falsify/.fapony/plan"));
    },
  );
  console.log("  ✓ memory template → scaffolded copy ignores the root config");
}

// Guessing the app wrong used to fall back to the repo root and write a log nobody reads.
export function testMemTemplateUnknownAppFails(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela"), { recursive: true });
      centralCopy(repo);
    },
    (repo) => {
      assert.throws(
        () => resolve(repo, join(repo, ".memory"), "nope"),
        /unknown app|Command failed/,
      );
    },
  );
  console.log("  ✓ memory template → unknown app exits instead of guessing");
}

// `fapony init` วางสำเนาไว้ที่ root เหมือนสำเนากลางเป๊ะ ๆ — ต่างกันแค่เดา app
// ไม่ได้ ถ้าเงื่อนไข central ดูแค่ว่ามี apps/ ไหม สำเนานี้จะถูกตัดสินว่าไม่ scaffolded แล้วตายที่
// guard `unknown app` ตั้งแต่คำสั่งแรก ทั้งที่ plan ของมันอยู่ข้าง ๆ
export function testMemTemplateInitAtMonorepoRoot(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela"), { recursive: true });
      cpSync(TEMPLATE, join(repo, ".fapony/.memory"), { recursive: true });
      mkdirSync(join(repo, ".fapony/plan"), { recursive: true });
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".fapony/.memory"));
      assert.equal(p.dir, join(repo, ".fapony/.memory"));
      assert.equal(p.plan, join(repo, ".fapony/plan"));
    },
  );
  console.log(
    "  ✓ memory template → `fapony init` at a monorepo root stays self-relative",
  );
}

// แยกไฟล์ต่อคนเพื่อไม่ให้ merge ชน แต่ต้องอ่านกลับมาเป็น log เดียว เรียงตาม ts —
// และต้องไม่ดูด log.YYYY-MM-DD.jsonl ที่ rotate เพิ่งย้ายออกไปกลับเข้ามา ไม่งั้น rotate ไม่ลดอะไรเลย
export function testMemTemplatePerPersonLogs(): void {
  withFixture(
    (repo) => {
      cpSync(TEMPLATE, join(repo, ".fapony/.memory"), { recursive: true });
      execSync('git config user.name "Som Chai/2"', { cwd: repo });
      const d = join(repo, ".fapony/.memory");
      const row = (ts: string, id: string, text: string) =>
        `${JSON.stringify({ ts, agent: "x", id, kind: "note", text })}\n`;
      writeFileSync(
        join(d, "log.jsonl"),
        row("2026-01-02T00:00:00Z", "b", "เก่า"),
      );
      writeFileSync(
        join(d, "log.somchai.jsonl"),
        row("2026-01-03T00:00:00Z", "c", "somchai"),
      );
      writeFileSync(
        join(d, "log.claude-code.jsonl"),
        row("2026-01-01T00:00:00Z", "a", "claude"),
      );
      writeFileSync(
        join(d, "log.2026-01-09.jsonl"),
        row("2026-01-09T00:00:00Z", "z", "archive"),
      );
    },
    (repo) => {
      const out = execSync(
        `bun -e 'const s = await import(process.env.S); console.log(JSON.stringify({ids: s.rows().map((r) => r.id), log: s.LOG}))'`,
        {
          cwd: repo,
          env: {
            ...process.env,
            S: join(repo, ".fapony/.memory/store.ts"),
            MEM_AGENT: "som chai/2",
          },
          encoding: "utf8",
        },
      );
      const got = JSON.parse(out.trim().split("\n").at(-1) as string) as {
        ids: string[];
        log: string;
      };
      assert.deepEqual(
        got.ids,
        ["a", "b", "c"],
        "รวมทุกไฟล์ เรียงตาม ts และข้าม archive",
      );
      // ชื่อไฟล์มาจาก git user.name ของ fixture ไม่ใช่ MEM_AGENT — ไม่งั้นสองคนที่เปิด
      // Claude Code จะเขียนไฟล์เดียวกันแล้วชนกันเหมือนเดิม
      assert.equal(got.log, join(repo, ".fapony/.memory/log.som-chai-2.jsonl"));
    },
  );
  console.log(
    "  ✓ memory template → per-person logs merge on read, archives stay out",
  );
}

// --- PLAN-convention-debt chunk 3: `add` requires --files (write-side recall fix) ---

function memRun(
  repo: string,
  memDir: string,
  args: string,
): { status: number; stdout: string; stderr: string } {
  const p = Bun.spawnSync(
    ["bun", join(memDir, "mem.ts"), ...args.split(" ").filter(Boolean)],
    {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    status: p.exitCode ?? 0,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
  };
}

// vela shape: one code copy at <root>/.memory/, the log under apps/<x>/.fapony/.memory/.
// The usage line printed on error must name the mem.ts that is actually running — it used to
// print the *log* dir, telling the reader to run a path that does not exist in this layout.
export function testMemTemplateUsageNamesTheRunningScript(): void {
  withFixture(
    (repo) => {
      mkdirSync(join(repo, "apps/vela/.fapony/plan"), { recursive: true });
      centralCopy(repo, {});
    },
    (repo) => {
      const memDir = join(repo, ".memory");
      const miss = Bun.spawnSync(
        ["bun", join(memDir, "mem.ts"), "add", "note", "x"],
        {
          cwd: repo,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, MEM_APP: "vela" },
        },
      );
      const err = miss.stderr.toString();
      assert.match(err, /--files is required/);
      assert.match(
        err,
        /bun \.memory\/mem\.ts/,
        `usage must name the running script, got: ${err}`,
      );
      assert.ok(
        !err.includes("apps/vela/.fapony/.memory/mem.ts"),
        `usage must not name the log dir (no mem.ts there), got: ${err}`,
      );
    },
  );
  console.log(
    "  \u2713 memory template \u2192 usage line names the running mem.ts, not the log dir",
  );
}

export function testMemTemplateAddRejectsMissingFiles(): void {
  withFixture(
    (repo) => {
      cpSync(TEMPLATE, join(repo, ".fapony/.memory"), { recursive: true });
      mkdirSync(join(repo, ".fapony/plan"), { recursive: true });
    },
    (repo) => {
      const d = join(repo, ".fapony/.memory");
      const miss = memRun(repo, d, `add note "x"`);
      assert.notEqual(
        miss.status,
        0,
        "add without --files must exit non-zero (required, not optional — fill rate 0)",
      );
      assert.match(miss.stderr, /--files is required/);
      const ok = memRun(repo, d, `add note "x" --files src/a.ts,src/b.ts`);
      assert.equal(ok.status, 0, `expected success, got: ${ok.stderr}`);
      const row = JSON.parse(
        readFileSync(join(d, memFile(d)), "utf-8")
          .trim()
          .split("\n")
          .at(-1) as string,
      ) as { files?: string[] };
      assert.deepEqual(row.files, ["src/a.ts", "src/b.ts"]);
    },
  );
  console.log(
    "  ✓ memory template → add rejects missing --files, rows carry files[]",
  );
}

function memFile(d: string): string {
  return (
    readdirSync(d).find(
      (f) => /^log\..*\.jsonl$/.test(f) && f !== "log.jsonl",
    ) ?? "log.jsonl"
  );
}

// --- kickoff resolves the plan path instead of comparing it as a literal string ---

// kickoff used to require `.fapony/plan/PLAN-x.md` byte-for-byte: a model that
// reconstructed the path slightly wrong got "(no entries)" and no way to notice.
// It now resolves an exact path, else a filename (with or without .md), else a path
// suffix — so `kickoff PLAN-demo` and `kickoff plan/PLAN-demo.md` both land.
export function testMemTemplateKickoffResolvesSpecByFilename(): void {
  withFixture(
    (repo) => {
      cpSync(TEMPLATE, join(repo, ".fapony/.memory"), { recursive: true });
      mkdirSync(join(repo, ".fapony/plan"), { recursive: true });
    },
    (repo) => {
      const d = join(repo, ".fapony/.memory");
      const add = memRun(
        repo,
        d,
        "add note ctx1 --files src/a.ts .fapony/plan/PLAN-demo.md",
      );
      assert.equal(add.status, 0, add.stderr);

      for (const arg of [
        ".fapony/plan/PLAN-demo.md", // exact
        "PLAN-demo.md", // basename with extension
        "PLAN-demo", // basename without
        "plan/PLAN-demo.md", // path suffix
      ]) {
        const out = memRun(repo, d, `kickoff ${arg}`);
        assert.equal(out.status, 0, `${arg}: ${out.stderr}`);
        assert.match(out.stdout, /ctx1/, `${arg} should find the row`);
        assert.match(
          out.stdout,
          /\.fapony\/plan\/PLAN-demo\.md/,
          `${arg} should report the canonical path`,
        );
      }
    },
  );
  console.log(
    "  ✓ memory template → kickoff resolves a spec by filename or suffix, not only exact path",
  );
}

// A repeated filename is ambiguous (plan + archived copy); a real miss must name the
// specs the log holds instead of printing "(no entries)" and exiting 0.
export function testMemTemplateKickoffAmbiguousAndMissAreLoud(): void {
  withFixture(
    (repo) => {
      cpSync(TEMPLATE, join(repo, ".fapony/.memory"), { recursive: true });
      mkdirSync(join(repo, ".fapony/plan"), { recursive: true });
      mkdirSync(join(repo, ".fapony/done"), { recursive: true });
    },
    (repo) => {
      const d = join(repo, ".fapony/.memory");
      memRun(
        repo,
        d,
        "add note dup1 --files src/a.ts .fapony/plan/PLAN-dup.md",
      );
      memRun(
        repo,
        d,
        "add note dup2 --files src/a.ts .fapony/done/PLAN-dup.md",
      );
      const amb = memRun(repo, d, "kickoff PLAN-dup.md");
      assert.notEqual(amb.status, 0, "an ambiguous filename must not pick one");
      assert.match(amb.stderr, /\.fapony\/plan\/PLAN-dup\.md/);
      assert.match(amb.stderr, /\.fapony\/done\/PLAN-dup\.md/);

      const miss = memRun(repo, d, "kickoff .fapony/plan/PLAN-typo.md");
      assert.notEqual(miss.status, 0, "a miss must not exit 0 silently");
      assert.match(
        miss.stderr,
        /\.fapony\/plan\/PLAN-dup\.md/,
        "a miss should list the specs the log has",
      );
    },
  );
  console.log(
    "  ✓ memory template → kickoff ambiguous/miss names candidates instead of going quiet",
  );
}
