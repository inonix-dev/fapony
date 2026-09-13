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
      mkdirSync(join(repo, "apps/vela/.memory"), { recursive: true });
      centralCopy(repo, {});
    },
    (repo) => {
      const p = resolve(repo, join(repo, ".memory"), "vela");
      assert.equal(p.plan, join(repo, "apps/vela/.fapony/plan"));
      assert.equal(p.done, join(repo, "apps/vela/.fapony/done"));
      assert.equal(p.dir, join(repo, "apps/vela/.memory"));
    },
  );
  console.log("  ✓ memory template → app migrated into .fapony/ uses it");
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
      assert.equal(p.dir, join(repo, "apps/vela/.memory"));
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
