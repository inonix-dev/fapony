// src/debt/cli.ts — `fapony debt` CLI: arg parsing + worktree resolution.
//
// Read-only stdout: no file writes, no state.db, no cache (rule 5b).

import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CONVENTIONS_FILE } from "../core/config.js";
import { formatDebt } from "./format.js";
import { resolveDebtScope } from "./load.js";
import { findPromotions, formatPromotions } from "./promotion.js";
import { debtForFile, debtScan } from "./scan.js";
import { ZONE_CAP } from "./types.js";

const USAGE = `usage: fapony debt [path] [options]
  --files f1,f2     check specific files instead of scanning
  --id <conv>       show only this convention
  --where <path>    narrow scope to files under this path
  --all             show all zones (default: cap at ${ZONE_CAP})
  --json            output raw JSON
  -h, --help        this help`;

/**
 * The dir `debt` measures: the nearest ancestor of `arg` (or cwd) that holds
 * `.fapony/conventions.json`, bounded by the git root.
 *
 * Jumping straight to the git root was the bug: in a monorepo the root has no
 * conventions.json and two apps have one each, so the mem resolver went
 * ambiguous and `debt` said "nothing tracked yet" while
 * apps/<x>/.fapony/conventions.json sat right there — and the positional path
 * argument was silently ignored. Falling back to the git root keeps single
 * repos run from a subdir scanning the whole repo.
 */
export function worktreeOf(arg: string | undefined): string {
  const base = resolve(arg ?? ".");
  let gitRoot: string | null = null;
  try {
    const p = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: base,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode === 0) gitRoot = p.stdout.toString().trim() || null;
  } catch {
    // not a repo — base is all we have
  }
  // `git rev-parse` returns a physical path (/var → /private/var on macOS),
  // so the boundary check compares realpaths, same as the mem resolver.
  const real = (d: string): string => {
    try {
      return realpathSync(d);
    } catch {
      return d;
    }
  };
  const boundary = gitRoot ? real(gitRoot) : null;
  let dir = base;
  while (true) {
    if (existsSync(join(dir, CONVENTIONS_FILE))) return dir;
    if (boundary && real(dir) === boundary) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return gitRoot ?? base;
}

export function cmdDebt(args: string[]): void {
  let path: string | undefined;
  let filesMode: string[] | null = null;
  let json = false;
  let filterId: string | undefined;
  let wherePath: string | undefined;
  let showAll = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--files") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) {
        console.error(`fapony debt: --files needs a value\n${USAGE}`);
        process.exit(1);
      }
      i++;
      filesMode = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (filesMode.length === 0) {
        console.error(`fapony debt: --files needs at least one path\n${USAGE}`);
        process.exit(1);
      }
    } else if (a === "--id") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) {
        console.error(`fapony debt: --id needs a convention id\n${USAGE}`);
        process.exit(1);
      }
      i++;
      filterId = v;
    } else if (a === "--where") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) {
        console.error(`fapony debt: --where needs a path\n${USAGE}`);
        process.exit(1);
      }
      i++;
      wherePath = v;
    } else if (a === "--all") {
      showAll = true;
    } else if (a === "--json") {
      json = true;
    } else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      return;
    } else if (!a.startsWith("--")) {
      path = a;
    } else {
      console.error(`fapony debt: unknown argument "${a}"\n${USAGE}`);
      process.exit(1);
    }
  }

  // Scan scope: the git root (convention `where` values are repo-relative)
  // paired with the nearest conventions file — scanning from the app dir
  // dropped repo-relative conventions and hid files outside the app
  // (bug mucvfiv5). Evidence (mem/ledger) keeps the old neighborhood scope.
  // Physical path (symlinks resolved) so --files resolution below compares
  // like with like against scope.scanRoot (/var → /private/var on macOS).
  let base = resolve(path ?? ".");
  try {
    base = realpathSync(base);
  } catch {
    // nonexistent — the not-found notes below handle it
  }
  const scope = resolveDebtScope(base);
  const worktree = scope.scanRoot;
  const loaded = scope.loaded;
  const evidenceDir = worktreeOf(path);

  if (filesMode) {
    const out = filesMode.map((f) => {
      const abs = isAbsolute(f) ? f : resolve(base, f);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        return { file: f, debt: [], note: "not found" as const };
      }
      return { file: f, debt: debtForFile(worktree, abs, loaded) };
    });
    if (json) {
      console.log(JSON.stringify({ worktree, files: out }, null, 2));
      return;
    }
    let any = false;
    for (const r of out) {
      for (const c of r.debt) {
        any = true;
        console.log(`${r.file} — ${c.id}: ${c.rule}`);
      }
      if ("note" in r) console.log(`${r.file} — ${r.note}`);
    }
    if (!any && out.every((r) => r.debt.length === 0)) {
      console.log("no convention debt in the given file(s)");
    }
    return;
  }

  if (loaded.path === null) {
    // SPEC §6: no conventions.json = completely silent, no error, no prompt to create one
    console.log(
      `fapony debt — no conventions.json in ${worktree} (nothing tracked yet)`,
    );
    return;
  }
  const report = debtScan(worktree, loaded);

  // --id filter: keep only the named convention
  if (filterId) {
    report.entries = report.entries.filter((e) => e.conv.id === filterId);
    report.declared = report.declared.filter((c) => c.id === filterId);
    report.checkedCount = 0; // not relevant when filtering
    report.dropped = report.dropped.filter((d) => d.id === filterId);
  }

  // --where filter: narrow file lists to paths under the given prefix
  if (wherePath) {
    const prefix = wherePath.replace(/\/+$/, "");
    for (const e of report.entries) {
      e.files = e.files.filter(
        (f) => f === prefix || f.startsWith(`${prefix}/`),
      );
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        { ...report, promotions: findPromotions(evidenceDir, report) },
        null,
        2,
      ),
    );
    return;
  }
  console.log(formatDebt(report, showAll));
  for (const w of loaded.warnings) console.log(`⚠ ${w}`);
  for (const l of formatPromotions(findPromotions(evidenceDir, report))) {
    console.log(l);
  }
}
