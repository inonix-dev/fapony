// store.ts — types + config + read/write primitives for the append-only memory log

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

// --- types ---

type WorkKind = "next" | "bug" | "decision" | "note" | "hold";

type WorkRow = {
  ts: string;
  agent: string;
  id: string;
  kind: WorkKind;
  text: string;
  spec?: string;
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
// ponytail: worktree ชื่อ wt-<app> = monorepo scope (apps/<app>/.memory).
// fapony template: repo เดี่ยว (ไม่มี apps/) → fallback ไป .memory ที่ root ตรงๆ
// ไม่ต้อง config/flag ทั้งสองแบบ
const app = process.env.MEM_APP ?? basename(root).replace(/^wt-/, "");
const monorepo = existsSync(`${root}/apps/${app}`);

// สำเนาที่ `fapony init` วางไว้ อยู่ใน <project>/.fapony/.memory/ — log กับ plan ของมัน
// ต้องอิงโฟลเดอร์ตัวเอง ไม่ใช่ git root: เคสที่พังจริงคือ apps/<x>/.fapony/.memory/ ใน monorepo
// ซึ่ง heuristic ด้านบนจะชี้ไป apps/<ชื่อ worktree>/.memory = เขียน log ปนโปรเจกต์อื่น
// (สำเนากลางแบบ vela — โค้ดชุดเดียวที่ root, log แยกราย app — ไม่เข้าเงื่อนไขนี้ ใช้ทางเดิม)
const scaffolded = import.meta.dir.includes("/.fapony/.memory");
const dir = scaffolded
  ? import.meta.dir
  : monorepo
    ? `${root}/apps/${app}/.memory`
    : `${root}/.memory`;
const LOG = `${dir}/log.jsonl`;

// โฟลเดอร์ที่ plan/ กับ done/ ของโปรเจกต์นี้อยู่ใต้มัน — จุดเดียวที่ประกอบ path เหล่านี้
// (ก่อนหน้านี้ commands/plan.ts hardcode `apps/<app>/plan` 10 จุด = ตายสนิทกับ repo เดี่ยว)
const planBase = scaffolded
  ? dirname(import.meta.dir) // <project>/.fapony
  : monorepo
    ? `${root}/apps/${app}`
    : root;

const agent = process.env.MEM_AGENT || process.env.USER || "unknown";

const KINDS: WorkKind[] = ["next", "bug", "decision", "note", "hold"];

// --- core ---

const rows = (): LogRow[] =>
  existsSync(LOG)
    ? readFileSync(LOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((l: string, i: number) => {
          try {
            return [JSON.parse(l) as LogRow];
          } catch {
            // ponytail: 1 บรรทัดพัง (escape เสีย) ไม่ควรทำให้ทั้ง log อ่านไม่ได้ — ข้ามแล้วเตือน
            console.error(`[mem] ข้ามบรรทัดที่ ${i + 1} (JSON เสีย)`);
            return [];
          }
        })
    : [];

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

// ponytail: กัน id ชน — base36 + increment ต่อ retry + random suffix
// ใช้ร่วมกันทุกที่ที่ต้อง generate WorkRow.id (cmdAdd, ship-log ใน cmdPlanSweep)
// ห้าม copy loop นี้ไปวางที่ใหม่ — แก้ scheme ที่นี่ที่เดียว
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

// เขียนแถวดิบ (ts/agent เดิม ไม่ generate ใหม่) — ใช้ตอน rotate ย้าย row เก่าไปไฟล์ใหม่
// ปกติเขียน log ต้องผ่าน put() เท่านั้น อันนี้ทางเดียวที่ยกเว้น
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
  dir,
  KINDS,
  LOG,
  nextId,
  planBase,
  put,
  root,
  rows,
};
