// store.ts — types + config + read/write primitives for the append-only memory log

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";

// --- types ---

type WorkKind = "next" | "bug" | "decision" | "note" | "hold";

type WorkRow = {
  ts: string;
  agent: string;
  id: string;
  kind: WorkKind;
  text: string;
  spec?: string;
  files?: string[];
};

type CloseRow = {
  ts: string;
  agent: string;
  kind: "close";
  ref: string;
  text: string;
};

type ClaimRow = {
  ts: string;
  agent: string;
  kind: "claim";
  ref: string;
};

type ReleaseRow = {
  ts: string;
  agent: string;
  kind: "release";
  ref: string;
  text?: string;
};

type SyncedRow = {
  ts: string;
  agent: string;
  kind: "synced";
  spec: string;
};

type LogRow = WorkRow | CloseRow | ClaimRow | ReleaseRow | SyncedRow;

// --- config ---

const root = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"])
  .stdout.toString()
  .trim();
// ponytail: worktree named wt-<app> = monorepo scope (apps/<app>/.fapony/.memory).
// fapony template: single repo (no apps/) → fallback straight to .fapony/.memory at root
// no config/flag needed for either shape
const app = process.env.MEM_APP ?? basename(root).replace(/^wt-/, "");
// app container folder found from {apps,packages,services}/<app>, first that exists — fixed order
// apps → packages → services, first hit wins (the order is the contract, not an accident)
// the `unknown app` guard below is still tied to apps/ as before — not widened this round
const appBase: string | undefined = ["apps", "packages", "services"]
  .map((d) => `${root}/${d}/${app}`)
  .find((p) => existsSync(p));
const monorepo = appBase !== undefined;

// The copy `fapony init` places lives in <project>/.fapony/.memory/ — its log and plan
// must key off their own folder, not the git root: the real broken case is apps/<x>/.fapony/.memory/ in a monorepo,
// where the heuristic below would point at apps/<worktree name>/.fapony/.memory = writing a log mixed into another project.
// But the central copy that was moved into .fapony/.memory at the monorepo root itself (single code copy, logs split per
// app — e.g. vela) must "not" count as scaffolded even though the path matches, because it still has to guess the app
// from the monorepo — the discriminator is "can the app be guessed" (`monorepo`), not "is there an app container folder":
// just having apps/ at the root does not make this copy the central one — `fapony init <monorepo root>` also places
// .fapony/.memory at the root, and it must key off its own folder, or it dies at the guard below
// from the very first command even though its plan sits right next to it.
const centralAtMonorepoRoot =
  import.meta.dir === `${root}/.fapony/.memory` && monorepo;
const scaffolded =
  import.meta.dir.includes("/.fapony/.memory") && !centralAtMonorepoRoot;

// apps/ exists but apps/<app> does not = guessed the app wrong (worktree name mismatch / typo in MEM_APP) — die here
// rather than fall back silently and write a log at the root that becomes an orphan nobody reads
// (a copy scaffolded under apps/<x>/.fapony/.memory/ keys off its own folder, needs no guess, so it does not hit this)
if (!scaffolded && !monorepo && existsSync(`${root}/apps`)) {
  console.error(
    `unknown app (guessed "${app}" from ${basename(root)}) — pass MEM_APP=<app>`,
  );
  process.exit(1);
}
// new default: log lives under .fapony/.memory — fall back to the old .memory/ only when an old log actually exists
// check for log.jsonl, not the dir: an empty folder someone accidentally mkdir'd must not lock the repo to the old layout
const newDir = appBase
  ? `${appBase}/.fapony/.memory`
  : `${root}/.fapony/.memory`;
const legacyDir = appBase ? `${appBase}/.memory` : `${root}/.memory`;
const dir = scaffolded
  ? import.meta.dir
  : existsSync(`${legacyDir}/log.jsonl`)
    ? legacyDir
    : newDir;
// who wrote this row — the client can override with MEM_AGENT ("claude-code", "opencode")
const agent = process.env.MEM_AGENT || process.env.USER || "unknown";

// filename = *person*, not client, deliberately different from agent above: naming files by MEM_AGENT
// would put two people running Claude Code back into the same log.claude-code.jsonl = same collision as before
// git user.name exists on every machine that can commit, so no env to set and no config to add
const person = (
  Bun.spawnSync(["git", "config", "user.name"]).stdout.toString().trim() ||
  process.env.USER ||
  "unknown"
)
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "");

// write your own file, read everyone's — two people never touch the same file = merge conflicts
// are structurally zero, no need for merge=union or GitHub behaving itself on PR merge
const LOG = `${dir}/log.${person || "unknown"}.jsonl`;

// log.jsonl = the pre-split original (still read forever, no migration needed)
// skip the log.YYYY-MM-DD.jsonl that rotate creates, or rotate reduces nothing because they get read back in
const isLogFile = (f: string): boolean =>
  f === "log.jsonl" ||
  (/^log\.[A-Za-z0-9._-]+\.jsonl$/.test(f) &&
    !/^log\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));

const logFiles = (): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter(isLogFile)
        .sort()
        .map((f) => join(dir, f))
    : [];

// the folder this project's plan/ and done/ live under — the single place these paths are assembled
// (previously commands/plan.ts hardcoded `apps/<app>/plan` in 10 places = dead on arrival for a single repo)
const planBase = scaffolded
  ? dirname(import.meta.dir) // <project>/.fapony
  : (appBase ?? root);

// fapony.config.json is the *agreement* on where plan lives; planBase above is only a guess —
// whenever the file exists it must beat the guess (vela declares `apps/vela/plan` outright, which happens to match the guess
// but a repo that puts plan elsewhere breaks silently if this is not read)
// read only at the project level: a copy scaffolded in apps/<x>/.fapony/ must not pick up the root
// monorepo's config, because that is another project's path
const configDir = scaffolded ? dirname(planBase) : root;

const configPaths = ((): Record<string, string> => {
  try {
    const raw = readFileSync(`${configDir}/fapony.config.json`, "utf8");
    return (JSON.parse(raw)?.paths ?? {}) as Record<string, string>;
  } catch {
    // no file / broken JSON → use the guessed values, not an error: memory must work without fapony
    return {};
  }
})();

const fromConfig = (key: string): string | null =>
  typeof configPaths[key] === "string"
    ? join(configDir, configPaths[key])
    : null;

// an app that moved plan into .fapony/ uses the new location; one that has not uses the old — so a monorepo migrates app by app
// without touching config (config has a single planDir, so declaring it points the other apps wrong too)
const base = existsSync(`${planBase}/.fapony`)
  ? `${planBase}/.fapony`
  : planBase;

const planDir = fromConfig("planDir") ?? `${base}/plan`;

// done/ sits beside plan/ (same depth after the move, relative links in files survive) — a repo still on the old layout
// with plan/done/ keeps using it, no need to move before sweeping
const doneDir =
  fromConfig("doneDir") ??
  (!existsSync(`${base}/done`) && existsSync(`${planDir}/done`)
    ? `${planDir}/done`
    : `${base}/done`);

// path used for display/logging — always relative to repo root (`apps/vela/plan`, `.fapony/plan`)
const rel = (p: string) => relative(root, p) || ".";

// the command we tell the user to type must be the path of the mem.ts actually running, not a constant —
// the copy `fapony init` places lives in .fapony/.memory/, not the .memory/ the old help text hardcoded ·
// keyed off import.meta.dir (where this code is) and NOT `dir` (where the log is): a monorepo can split the
// two — vela keeps one code copy at <root>/.memory/ and a log per app under apps/<x>/.fapony/.memory/, and
// printing the log dir there told the reader to run a mem.ts that does not exist
const memCmd = `bun ${rel(import.meta.dir)}/mem.ts`;

const KINDS: WorkKind[] = ["next", "bug", "decision", "note", "hold"];

// --- core ---

const rows = (): LogRow[] =>
  logFiles()
    .flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((l: string, i: number) => {
          try {
            return [JSON.parse(l) as LogRow];
          } catch {
            // ponytail: one broken line (bad escape) must not make the whole log unreadable — skip it and warn
            console.error(
              `[mem] skipped ${basename(f)} line ${i + 1} (bad JSON)`,
            );
            return [];
          }
        }),
    )
    // concatenating several files scrambles the time order — every selector reads top-down assuming ts order
    .sort((a, b) => a.ts.localeCompare(b.ts));

function put(r: Omit<WorkRow, "ts" | "agent">): void;
function put(r: Omit<CloseRow, "ts" | "agent">): void;
function put(r: Omit<ClaimRow, "ts" | "agent">): void;
function put(r: Omit<ReleaseRow, "ts" | "agent">): void;
function put(r: Omit<SyncedRow, "ts" | "agent">): void;
function put(
  r:
    | Omit<WorkRow, "ts" | "agent">
    | Omit<CloseRow, "ts" | "agent">
    | Omit<ClaimRow, "ts" | "agent">
    | Omit<ReleaseRow, "ts" | "agent">
    | Omit<SyncedRow, "ts" | "agent">,
) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    LOG,
    `${JSON.stringify({ ts: new Date().toISOString(), agent, ...r })}\n`,
  );
}

// ponytail: prevent id collisions — base36 + increment per retry + random suffix
// shared everywhere a WorkRow.id must be generated (cmdAdd, ship-log in cmdPlanSweep)
// do not copy this loop elsewhere — change the scheme here only
function nextId(all: LogRow[]): string {
  const used = new Set(all.map((r) => ("id" in r ? r.id : "")));
  let base = Date.now();
  let id = base.toString(36);
  while (used.has(id)) {
    id = base.toString(36) + Math.random().toString(36).slice(2, 4);
    base++;
  }
  return id;
}

// write a raw row (original ts/agent, no regeneration) — used when rotate moves old rows to a new file
// normally writing to the log must go through put(); this is the only exception
const appendRaw = (path: string, r: LogRow): void =>
  appendFileSync(path, `${JSON.stringify(r)}\n`);

export type {
  ClaimRow,
  CloseRow,
  LogRow,
  ReleaseRow,
  SyncedRow,
  WorkKind,
  WorkRow,
};
export {
  agent,
  app,
  appendRaw,
  configDir,
  dir,
  doneDir,
  KINDS,
  LOG,
  memCmd,
  nextId,
  person,
  planBase,
  planDir,
  put,
  rel,
  root,
  rows,
};
