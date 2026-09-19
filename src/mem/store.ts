// store.ts — types + config + read/write primitives for the append-only memory log
//
// Moved from templates/mem/store.ts (2026-09-19) as part of PLAN-agent-one-call chunk 1.
// The template was copied into every repo via `fapony init-mem`; now fapony owns the code
// and calls it directly via `fapony mem <sub>`. Path resolution is no longer based on
// import.meta.dir — initStore() receives the worktree explicitly from the CLI dispatch.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { resolveAppFaponyDir } from "../memory.js";

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

// --- mutable state (populated by initStore) ---

let root = "";
let dir = "";
let planDir = "";
let doneDir = "";
let agent = "";
let person = "";
let LOG = "";
let memCmd = "";
let planBase = "";
let app = "";

// --- init ---

/**
 * Initialize the store for a given worktree. Must be called before using any
 * export. The CLI dispatch layer calls this with the resolved worktree path.
 *
 * memDir comes from resolveMemDir below — the same app-scoped guess the reader
 * (src/memory.ts resolveMemDir) makes, so a row the writer appends is a row the
 * reader finds. It used to walk up from the worktree instead, which dropped the
 * row at the git root in a monorepo while mem_find read `<apps|packages|services>/<app>`.
 */
export function initStore(worktree: string): void {
  root = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: worktree,
  })
    .stdout.toString()
    .trim();
  if (!root) root = worktree;

  const faponyDir = resolveAppFaponyDir(worktree); // <app|repo>/.fapony
  dir = resolveMemDir(worktree, faponyDir);

  // planBase: the folder this project's plan/done live under. Taking it from
  // faponyDir (not dirname(dir)) keeps it correct under the legacy `.memory`
  // layout, where dir sits beside .fapony rather than inside it.
  planBase = faponyDir;

  // app name for display — the directory containing .fapony
  app = basename(dirname(faponyDir));

  // Read fapony.config.json
  const configDir = planBase === `${root}/.fapony` ? root : dirname(planBase);
  const configPaths = ((): Record<string, string> => {
    try {
      const raw = readFileSync(`${configDir}/fapony.config.json`, "utf8");
      return (JSON.parse(raw)?.paths ?? {}) as Record<string, string>;
    } catch {
      return {};
    }
  })();
  const fromConfig = (key: string): string | null =>
    typeof configPaths[key] === "string"
      ? join(configDir, configPaths[key])
      : null;

  planDir = fromConfig("planDir") ?? `${planBase}/plan`;

  // done/ sits beside plan/ (same depth, relative links survive)
  doneDir =
    fromConfig("doneDir") ??
    (!existsSync(`${planBase}/done`) && existsSync(`${planDir}/done`)
      ? `${planDir}/done`
      : `${planBase}/done`);

  agent = process.env.MEM_AGENT || process.env.USER || "unknown";

  // filename = *person*, not client — naming by MEM_AGENT would collide
  person = (
    Bun.spawnSync(["git", "config", "user.name"], { cwd: root })
      .stdout.toString()
      .trim() ||
    process.env.USER ||
    "unknown"
  )
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  LOG = `${dir}/log.${person || "unknown"}.jsonl`;
  memCmd = `fapony mem`;
}

function resolveMemDir(
  worktree: string,
  base = resolveAppFaponyDir(worktree),
): string {
  const legacyDir = join(base, "..", ".memory");
  const newDir = join(base, ".memory");
  // Mirror memory.ts resolveMemDir exactly (legacy log.jsonl first, then the
  // new layout) so the writer and the reader cannot drift apart.
  if (existsSync(join(legacyDir, "log.jsonl"))) return legacyDir;
  if (existsSync(newDir)) return newDir;
  return newDir;
}

// --- log file helpers ---

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
            console.error(
              `[mem] skipped ${basename(f)} line ${i + 1} (bad JSON)`,
            );
            return [];
          }
        }),
    )
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

const appendRaw = (path: string, r: LogRow): void =>
  appendFileSync(path, `${JSON.stringify(r)}\n`);

const rel = (p: string) => relative(root, p) || ".";

const KINDS: WorkKind[] = ["next", "bug", "decision", "note", "hold"];

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
