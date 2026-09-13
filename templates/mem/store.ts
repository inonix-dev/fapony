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
// ponytail: worktree ชื่อ wt-<app> = monorepo scope (apps/<app>/.fapony/.memory).
// fapony template: repo เดี่ยว (ไม่มี apps/) → fallback ไป .fapony/.memory ที่ root ตรงๆ
// ไม่ต้อง config/flag ทั้งสองแบบ
const app = process.env.MEM_APP ?? basename(root).replace(/^wt-/, "");
// โฟลเดอร์รวม app หาจาก {apps,packages,services}/<app> ตัวแรกที่มีจริง — ลำดับคงที่
// apps → packages → services ตัวแรกที่เจอชนะ (ลำดับคือสัญญา ไม่ใช่บังเอิญ)
// guard `unknown app` ข้างล่างยังผูกกับ apps/ เหมือนเดิม — ไม่ขยายในรอบนี้
const appBase: string | undefined = ["apps", "packages", "services"]
  .map((d) => `${root}/${d}/${app}`)
  .find((p) => existsSync(p));
const monorepo = appBase !== undefined;

// สำเนาที่ `fapony init` วางไว้ อยู่ใน <project>/.fapony/.memory/ — log กับ plan ของมัน
// ต้องอิงโฟลเดอร์ตัวเอง ไม่ใช่ git root: เคสที่พังจริงคือ apps/<x>/.fapony/.memory/ ใน monorepo
// ซึ่ง heuristic ด้านล่างจะชี้ไป apps/<ชื่อ worktree>/.fapony/.memory = เขียน log ปนโปรเจกต์อื่น
// แต่สำเนากลางที่ย้ายเข้า .fapony/.memory ที่ root ของ monorepo เอง (โค้ดชุดเดียว, log แยกราย
// app — เช่น vela) ต้อง "ไม่" ถือเป็น scaffolded แม้ path จะแมตช์เหมือนกัน เพราะยังต้องเดา app
// จาก monorepo อยู่ — ตัวแยกคือ "เดา app ได้ไหม" (`monorepo`) ไม่ใช่ "มีโฟลเดอร์รวม app ไหม":
// แค่มี apps/ อยู่ที่ root ไม่ได้แปลว่าสำเนานี้เป็นสำเนากลาง — `fapony init <monorepo root>` ก็วาง
// .fapony/.memory ที่ root เหมือนกัน แล้วมันต้องอิงโฟลเดอร์ตัวเอง ไม่งั้นตายที่ guard ข้างล่าง
// ตั้งแต่คำสั่งแรกทั้งที่ plan ของมันอยู่ข้าง ๆ นั่นเอง
const centralAtMonorepoRoot =
  import.meta.dir === `${root}/.fapony/.memory` && monorepo;
const scaffolded =
  import.meta.dir.includes("/.fapony/.memory") && !centralAtMonorepoRoot;

// มี apps/ แต่ไม่มี apps/<app> = เดา app ผิด (worktree ชื่อไม่ตรง / typo ใน MEM_APP) — ตายตรงนี้
// ดีกว่า fallback เงียบ ๆ ไปเขียน log ที่ root ซึ่งจะกลายเป็น log กำพร้าที่ไม่มีใครอ่าน
// (สำเนาที่ scaffold ไว้ใต้ apps/<x>/.fapony/.memory/ อิงโฟลเดอร์ตัวเอง ไม่ต้องเดา จึงไม่เข้าเงื่อนไขนี้)
if (!scaffolded && !monorepo && existsSync(`${root}/apps`)) {
  console.error(
    `unknown app (guessed "${app}" from ${basename(root)}) — pass MEM_APP=<app>`,
  );
  process.exit(1);
}
// default ใหม่: log อยู่ใต้ .fapony/.memory — fallback ไป .memory/ เดิมเมื่อมี log เก่าอยู่จริง
// เช็ค log.jsonl ไม่ใช่ dir: โฟลเดอร์ว่างที่ใครเผลอ mkdir ทิ้งไว้ต้องไม่ล็อก repo ไว้กับ layout เก่า
const newDir = appBase
  ? `${appBase}/.fapony/.memory`
  : `${root}/.fapony/.memory`;
const legacyDir = appBase ? `${appBase}/.memory` : `${root}/.memory`;
const dir = scaffolded
  ? import.meta.dir
  : existsSync(`${legacyDir}/log.jsonl`)
    ? legacyDir
    : newDir;
// ชื่อคนเขียน ต้องมาก่อน LOG เพราะ log แยกไฟล์ตามคน
const agent = (process.env.MEM_AGENT || process.env.USER || "unknown").replace(
  /[^A-Za-z0-9._-]/g,
  "-",
);

// เขียนไฟล์ของตัวเอง อ่านของทุกคน — สองคนไม่เคยแตะไฟล์เดียวกัน = merge conflict
// เป็นศูนย์โดยโครงสร้าง ไม่ต้องพึ่ง merge=union หรือให้ GitHub ทำตัวดีตอน merge PR
// ponytail: ไม่เพิ่ม config field — ชื่อไฟล์ derive จาก MEM_AGENT ที่ทุกแถวใช้อยู่แล้ว
const LOG = `${dir}/log.${agent}.jsonl`;

// log.jsonl = ของเดิมก่อนแยกไฟล์ (ยังอ่านตลอดไป ไม่ต้อง migrate)
// ข้าม log.YYYY-MM-DD.jsonl ที่ rotate สร้าง ไม่งั้น rotate จะไม่ลดอะไรเลยเพราะอ่านกลับเข้ามา
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

// โฟลเดอร์ที่ plan/ กับ done/ ของโปรเจกต์นี้อยู่ใต้มัน — จุดเดียวที่ประกอบ path เหล่านี้
// (ก่อนหน้านี้ commands/plan.ts hardcode `apps/<app>/plan` 10 จุด = ตายสนิทกับ repo เดี่ยว)
const planBase = scaffolded
  ? dirname(import.meta.dir) // <project>/.fapony
  : (appBase ?? root);

// fapony.config.json คือ *ข้อตกลง* ว่า plan อยู่ไหน ส่วน planBase ข้างบนเป็นแค่การเดา —
// มีไฟล์เมื่อไหร่ต้องชนะการเดาเสมอ (vela ประกาศ `apps/vela/plan` ไว้ตรง ๆ บังเอิญตรงกับที่เดาได้
// แต่ repo ที่วาง plan ไว้ที่อื่นจะพังเงียบ ๆ ถ้าไม่อ่าน)
// อ่านที่ระดับโปรเจกต์เท่านั้น: สำเนาที่ scaffold ใน apps/<x>/.fapony/ ต้องไม่หยิบ config ของ
// monorepo ที่ root มาใช้ เพราะนั่นเป็น path ของอีกโปรเจกต์หนึ่ง
const configDir = scaffolded ? dirname(planBase) : root;

const configPaths = ((): Record<string, string> => {
  try {
    const raw = readFileSync(`${configDir}/fapony.config.json`, "utf8");
    return (JSON.parse(raw)?.paths ?? {}) as Record<string, string>;
  } catch {
    // ไม่มีไฟล์ / JSON เสีย → ใช้ค่าที่เดาได้ ไม่ใช่ error: memory ต้องทำงานได้โดยไม่มี fapony
    return {};
  }
})();

const fromConfig = (key: string): string | null =>
  typeof configPaths[key] === "string"
    ? join(configDir, configPaths[key])
    : null;

// app ที่ย้าย plan เข้า .fapony/ แล้วให้ใช้ของใหม่ ที่ยังไม่ย้ายใช้ของเดิม — โมโนเรโปจึงย้ายทีละ app ได้
// โดยไม่ต้องแตะ config (config มี planDir ค่าเดียว ประกาศเมื่อไหร่ app อื่นก็ชี้ผิดตามไปด้วย)
const base = existsSync(`${planBase}/.fapony`)
  ? `${planBase}/.fapony`
  : planBase;

const planDir = fromConfig("planDir") ?? `${base}/plan`;

// done/ อยู่ข้าง plan/ (ย้ายแล้วลึกเท่าเดิม ลิงก์ relative ในไฟล์รอด) — repo ที่ยัง layout เก่า
// เก็บ plan/done/ ไว้ ก็ใช้ของเดิมต่อ ไม่ต้องย้ายก่อนถึงจะ sweep ได้
const doneDir =
  fromConfig("doneDir") ??
  (!existsSync(`${base}/done`) && existsSync(`${planDir}/done`)
    ? `${planDir}/done`
    : `${base}/done`);

// path ที่เอาไว้โชว์/บันทึกลง log — อิง repo root เสมอ (`apps/vela/plan`, `.fapony/plan`)
const rel = (p: string) => relative(root, p) || ".";

// คำสั่งที่บอกให้ผู้ใช้พิมพ์ ต้องเป็น path ของ mem.ts ตัวที่กำลังรันอยู่จริง ไม่ใช่ค่าคงที่ —
// สำเนาที่ `fapony init` วางไว้อยู่ที่ .fapony/.memory/ ไม่ใช่ .memory/ ที่ help text เดิม hardcode
const memCmd = `bun ${rel(dir)}/mem.ts`;

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
            // ponytail: 1 บรรทัดพัง (escape เสีย) ไม่ควรทำให้ทั้ง log อ่านไม่ได้ — ข้ามแล้วเตือน
            console.error(
              `[mem] skipped ${basename(f)} line ${i + 1} (bad JSON)`,
            );
            return [];
          }
        }),
    )
    // หลายไฟล์ต่อกันแล้วลำดับเวลาสลับ — ทุก selector อ่านจากบนลงล่างโดยถือว่าเรียงตาม ts
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
  configDir,
  dir,
  doneDir,
  KINDS,
  LOG,
  memCmd,
  nextId,
  planBase,
  planDir,
  put,
  rel,
  root,
  rows,
};
