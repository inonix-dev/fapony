// store.ts — types + config + read/write primitives for the append-only memory log
//
// Moved from templates/mem/store.ts (2026-09-19) as part of PLAN-agent-one-call chunk 1.
// The template was copied into every repo via `fapony init-mem`; now fapony owns the code
// and calls it directly via `fapony mem <sub>`. Path resolution is no longer based on
// import.meta.dir — initStore() receives the worktree explicitly from the CLI dispatch.

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { resolveMemDir } from "../memory.js";

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

// --- identity ---
//
// `agent` goes in every row, `person` names the file. Both used to end in
// "unknown", which is not a fallback: two machines with no git and no $USER
// wrote the same filename and their rows interleaved with no way to tell them
// apart. Generic OS accounts collide the same way — `admin`/`user`/`owner` are
// what a fresh install offers, so treat them as absent rather than as a name.
// git user.email is unique by construction; the machine tag is the last resort,
// hashed because this file is committed and a raw MAC address is not ours to
// publish. user.email is only spawned when the cheap sources fail — initStore
// sits on the mem_add hot path (git config ≈ 12ms).

const GENERIC_NAMES = new Set([
  "admin",
  "user",
  "owner",
  "root",
  "ubuntu",
  "ec2-user",
  "vagrant",
  "dev",
  "developer",
  "node",
  "unknown",
]);

const usable = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s && !GENERIC_NAMES.has(s.toLowerCase()) ? s : null;
};

// `env: process.env` is not redundant: Bun.spawnSync snapshots the environment
// at startup, so a variable set at runtime (GIT_CONFIG_GLOBAL in a test, MEM_*
// set by a wrapper) never reaches the child without passing it explicitly.
const gitConfig = (key: string, cwd: string): string | null =>
  Bun.spawnSync(["git", "config", key], { cwd, env: process.env })
    .stdout.toString()
    .trim() || null;

function machineSeed(): string {
  try {
    const id = readFileSync("/etc/machine-id", "utf8").trim();
    if (id) return id;
  } catch {
    // no /etc/machine-id (macOS) — fall through to the interface list
  }
  for (const ifaces of Object.values(networkInterfaces()))
    for (const i of ifaces ?? [])
      if (!i.internal && i.mac && i.mac !== "00:00:00:00:00:00") return i.mac;
  return hostname();
}

const machineTag = (): string =>
  `m-${createHash("sha256").update(machineSeed()).digest("hex").slice(0, 8)}`;

const slug = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

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
 * `overrideMemDir` (from --mem-dir flag) skips resolution entirely.
 * Otherwise resolveMemDir() walks up from cwd — the same dir the reader
 * (src/memory.ts) uses, so writer and reader cannot drift apart.
 */
export function initStore(worktree: string, overrideMemDir?: string): void {
  root = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: worktree,
  })
    .stdout.toString()
    .trim();
  if (!root) root = worktree;

  dir =
    resolveMemDir(worktree, overrideMemDir) ??
    join(worktree, ".fapony", ".memory");

  // planBase: the .fapony dir — plan/done/conventions live here.
  // Derive from dir by going up from .fapony/.memory → .fapony
  planBase = dirname(dir);

  // app name for display — the directory containing .fapony
  app = dirname(planBase);

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

  let emailCache: string | null | undefined;
  const email = (): string | null =>
    emailCache !== undefined
      ? emailCache
      : (emailCache = gitConfig("user.email", root));

  agent =
    process.env.MEM_AGENT?.trim() ||
    usable(process.env.USER) ||
    usable(email()) ||
    machineTag();

  // filename = *person*, not client — naming by MEM_AGENT would collide
  person = slug(
    usable(gitConfig("user.name", root)) ||
      usable(process.env.USER) ||
      usable(email()) ||
      machineTag(),
  );

  LOG = `${dir}/log.${person}.jsonl`;
  memCmd = `fapony mem`;
}

// --- log file helpers ---

const isLogFile = (f: string): boolean =>
  f === "log.jsonl" ||
  (/^log\.[A-Za-z0-9._-]+\.jsonl$/.test(f) &&
    !/^log\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));

const listLogs = (match: (f: string) => boolean): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter(match)
        .sort()
        .map((f) => join(dir, f))
    : [];

const logFiles = (): string[] => listLogs(isLogFile);

const archivedFiles = (): string[] =>
  listLogs((f) => /^log\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));

// --- core ---

const parseLog = (f: string): LogRow[] =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l: string, i: number) => {
      try {
        return [JSON.parse(l) as LogRow];
      } catch {
        console.error(`[mem] skipped ${basename(f)} line ${i + 1} (bad JSON)`);
        return [];
      }
    });

const byTs = (a: LogRow, b: LogRow) => a.ts.localeCompare(b.ts);

// The live view: what `rotate` counts and what open-work commands read. It must
// stay archive-free or rotate re-imports the rows it just moved out and never
// gets under its own threshold.
const rows = (): LogRow[] => logFiles().flatMap(parseLog).sort(byTs);

// The recall view: rotated rows included. A bug closed six months ago is exactly
// what `find` exists to surface — rotate shrinks the live file, it does not
// decide what is still worth remembering.
const allRows = (): LogRow[] =>
  [...logFiles(), ...archivedFiles()].flatMap(parseLog).sort(byTs);

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
  allRows,
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
