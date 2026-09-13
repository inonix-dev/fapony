// commands/plan.ts — plan-sweep: หา PLAN-*.md ที่ header บอก shipped แล้วแต่ยังไม่ย้ายเข้า done/
// เหตุผล: ย้ายมือ = ต้องไล่แก้ relative link เอง (ในไฟล์ + ไฟล์อื่นที่ลิงก์มา) → ข้ามขั้นตอนบ่อย
// ไม่มี arg = report เฉยๆ (ปลอดภัย โชว์ทุก kickoff/stale run ได้)
// <file.md> = เช็คไฟล์เดียวว่าพร้อมย้ายไหม
// <file.md> --apply = git mv + แก้ markdown link ในไฟล์เอง + แก้ inbound link จากไฟล์อื่นใน plan/
//                      + แจ้ง warning plain-text mention (detect-only, ไม่ auto-fix)

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { openRows } from "../selectors.js";
import { dir as memDir, nextId, planBase, put, root, rows } from "../store.js";

const SHIPPED = /^>\s*✅/m;

// header ✅ shipped ไม่ได้อยู่บรรทัดแรกอีกแล้ว — plan format ปัจจุบันขึ้นต้นด้วย frontmatter
// แล้วตามด้วย `# title` (ดู templates/PLAN.md) เช็กหัวไฟล์แทนที่จะเช็กบรรทัดแรกบรรทัดเดียว
export const hasShippedHeader = (file: string): boolean =>
  SHIPPED.test(readFileSync(file, "utf8").slice(0, 2048));

const planDir = () => join(planBase, "plan");

// done/ อยู่ข้าง plan/ (ย้ายแล้วลึกเท่าเดิม ลิงก์ relative ในไฟล์รอด) — repo ที่ยัง layout เก่า
// เก็บ plan/done/ ไว้ ก็ใช้ของเดิมต่อ ไม่ต้องย้ายก่อนถึงจะ sweep ได้
const doneDirOf = (dir: string): string => {
  const sibling = join(planBase, "done");
  return existsSync(sibling) || !existsSync(join(dir, "done"))
    ? sibling
    : join(dir, "done");
};

// path ที่เอาไว้โชว์/บันทึกลง log — อิง repo root เสมอ (`apps/vela/plan`, `.fapony/plan`)
const rel = (p: string) => relative(root, p) || ".";

// คำสั่งที่บอกให้ผู้ใช้พิมพ์ ต้องเป็น path ของ mem.ts ตัวที่กำลังรันอยู่จริง ไม่ใช่ค่าคงที่
const memCmd = `bun ${rel(memDir)}/mem.ts`;
export const planSweepCmd = `${memCmd} plan-sweep`;

const mdFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? mdFiles(join(dir, e.name))
          : e.name.endsWith(".md")
            ? [join(dir, e.name)]
            : [],
      )
    : [];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ไฟล์ย้าย dir แล้ว (เนื้อหาเดิม) — markdown link เดิมหมายถึง path เดิมเมื่ออิง oldDir, ต้อง re-relativize ผ่าน newDir
// resolve จาก newDir (ที่ไฟล์อยู่ตอนนี้) — ถ้า target ก็ย้ายมา same dir → ได้ชื่อไฟล์ล้วน,
// ถ้า target ยังอยู่ oldDir → ได้ ../target (ถูกทั้งสองทาง)
// pass 1 only — แก้เฉพาะ [text](target) markdown links, ไม่แตะ plain text
export const rewriteMovedFileLinks = (
  file: string,
  oldDir: string,
  newDir: string,
): number => {
  const src = readFileSync(file, "utf8");
  let n = 0;

  const out = src.replace(/\]\(([^)]+)\)/g, (m, t: string) => {
    const [target, anchor] = t.split("#");
    if (!target || /^(https?:|mailto:|\/)/.test(target)) return m;
    // resolve from where the file IS now (newDir); if target doesn't exist
    // there, fall back to oldDir (target stayed in original location)
    const inNew = resolve(newDir, target);
    const abs = existsSync(inNew) ? inNew : resolve(oldDir, target);
    n++;
    return `](${relative(newDir, abs) || "."}${anchor ? `#${anchor}` : ""})`;
  });

  if (n) writeFileSync(file, out);
  return n;
};

// ไฟล์อื่นที่ลิงก์ชี้มาที่ path เดิม (oldAbs) → แก้ให้ชี้ path ใหม่ (newAbs) แทน
// pass 1 only — แก้เฉพาะ [text](target) markdown links, ไม่แตะ plain text
export const rewriteMarkdownLinks = (
  file: string,
  oldAbs: string,
  newAbs: string,
): number => {
  const src = readFileSync(file, "utf8");
  let n = 0;
  const newRel = relative(dirname(file), newAbs) || ".";

  const out = src.replace(/\]\(([^)]+)\)/g, (m, t: string) => {
    const [target, anchor] = t.split("#");
    if (!target || /^(https?:|mailto:|\/)/.test(target)) return m;
    if (resolve(dirname(file), target) !== oldAbs) return m;
    n++;
    return `](${newRel}${anchor ? `#${anchor}` : ""})`;
  });

  if (n) writeFileSync(file, out);
  return n;
};

// นับ plain-text mention ของ target filename ในไฟล์ (detect-only, ไม่เขียนไฟล์)
// regex: ไม่ใช่ markdown link [text](url) — จับทั้งแบบมี/ไม่มี .md extension
// ครอบคลุม: prose, backtick code span, code fence — ทุก context ที่ไม่ใช่ markdown link
//
// Fix (2026-09-02): ตัด markdown link ทั้งก้อน [text](target) ออกก่อน (ทั้ง display text และ
// target — ไม่ใช่แค่ target) แล้วค่อยรัน plain-text regex บน string ที่เหลือ โดยไม่ต้องพึ่ง
// lookbehind แล้ว — lookbehind เดิม `(?<![/\[(])` ตั้งใจกัน false-positive จาก markdown link
// แต่ผลข้างเคียงคือ exclude ทุก mention ที่มี `/` นำหน้าไปด้วย (เช่น `done/PLAN-x.md` หรือ
// `apps/vela/plan/PLAN-x.md`) — false-negative ตัวจริงที่พลาดใน 6e411042
// Fix รอบแรก (ตัดแค่ `](target)`) พลาด — เหลือ `[display-text]` ไว้ไม่ได้ตัด ทำให้ link ที่ถูกต้อง
// อยู่แล้วอย่าง `[PLAN-x.md](../done/PLAN-x.md)` (pattern จริงในไฟล์นี้ทั้งหมด) โดน count ซ้ำเป็น
// plain-text mention — ต้องตัดทั้งก้อน [..](..)  ไม่ใช่แค่ส่วน (..)
export const countPlainTextMentions = (
  file: string,
  target: string,
): number => {
  const src = readFileSync(file, "utf8");
  const baseName = target.replace(/\.md$/, "");
  const withoutLinks = src.replace(/\[[^\]]*\]\([^)]+\)/g, "");
  const plainRe = new RegExp(
    `\\b${escapeRe(baseName)}(?:\\.md)?\\b(?!\\.\\w)`,
    "g",
  );
  let count = 0;

  while (plainRe.test(withoutLinks)) count++;
  return count;
};

// ใช้ร่วมกับ dashboard (now/kickoff) — ไฟล์ plan/ ที่มี header shipped แต่ยังไม่ย้ายเข้า done/
export const shippedNotMoved = (): string[] => {
  const dir = planDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .filter((name) => hasShippedHeader(join(dir, name)));
};

export const cmdPlanSweep = (a: string[]) => {
  const dir = planDir();
  if (!existsSync(dir)) {
    console.log(`ไม่มี ${rel(dir)}/ — ไม่มีอะไรให้ sweep`);
    return;
  }
  const doneDir = doneDirOf(dir);
  const candidates = shippedNotMoved();

  const target = a.find((x) => x.endsWith(".md"));
  const apply = a.includes("--apply");

  if (!target) {
    if (!candidates.length) {
      console.log(`ไม่มี PLAN ที่มี header ✅ shipped ค้างอยู่นอก ${rel(doneDir)}/`);
      return;
    }
    const all = rows();
    console.log(
      `# plan-sweep — ${candidates.length} ไฟล์มี header shipped แต่ยังไม่ย้าย\n`,
    );
    for (const name of candidates) {
      const spec = `${rel(dir)}/${name}`;
      const openN = openRows(all).filter((r) => r.spec === spec).length;
      const warn = openN
        ? `  ⚠ ${openN} แถวเปิดอยู่ (next/bug/hold/decision/note) — เช็คก่อนย้าย`
        : "";
      console.log(`- ${rel(dir)}/${name}${warn}`);
    }
    console.log(`\nย้าย: ${planSweepCmd} <ไฟล์.md> --apply`);
    return;
  }

  const src = join(dir, target);
  if (!existsSync(src)) {
    console.error(`ไม่พบ ${rel(src)}`);
    process.exit(1);
  }
  const shipped = hasShippedHeader(src);
  if (!apply) {
    console.log(
      shipped
        ? `${target}: มี header ✅ shipped — พร้อมย้าย (เพิ่ม --apply)`
        : `${target}: ไม่มี header ✅ shipped ที่หัวไฟล์ — ตรวจก่อนว่าจบทั้งไฟล์จริงไหม`,
    );
    return;
  }

  // ponytail: --apply เดิม (ก่อนหน้านี้) ไม่บังคับ 2 เงื่อนไขนี้เลย — ผ่าน dry-run message ได้ก็จริง
  // แต่รัน --apply ตรง ๆ ข้ามได้หมด → เสี่ยงเวลา agent ship เองอัตโนมัติไม่มีคนเช็ค แก้เป็น hard block
  if (!shipped && !process.env.MEM_FORCE) {
    console.error(
      `${target}: ไม่มี header ✅ shipped ที่หัวไฟล์ — ห้ามย้าย (MEM_FORCE=1 ถ้าจำเป็นจริง ๆ)`,
    );
    process.exit(1);
  }
  const openSpec = `${rel(dir)}/${target}`;
  const openN = openRows(rows()).filter((r) => r.spec === openSpec);
  if (openN.length && !process.env.MEM_FORCE) {
    console.error(
      `${target}: ยังมี ${openN.length} แถวเปิดอยู่ (next/bug/hold/decision/note) — ปิดหรือย้าย spec ก่อน (MEM_FORCE=1 ถ้าจำเป็นจริง ๆ):\n` +
        openN.map((r) => `  [${r.id}] ${r.kind} ${r.text}`).join("\n"),
    );
    process.exit(1);
  }

  const dst = join(doneDir, target);
  if (existsSync(dst)) {
    console.error(`มี ${rel(dst)} อยู่แล้ว`);
    process.exit(1);
  }

  // ponytail: ไฟล์ที่เพิ่งเขียนในรอบนี้อาจยังไม่ git add — `git mv` fail แบบเงียบ (exit 128, ไม่ throw)
  // แล้วโค้ดต่อไปพัง ENOENT ตอนอ่าน dst ที่ไม่มีจริง — stage ก่อนเสมอ (no-op ถ้า track อยู่แล้ว)
  mkdirSync(doneDir, { recursive: true });
  Bun.spawnSync(["git", "add", src]);
  const mv = Bun.spawnSync(["git", "mv", src, dst]);
  if (mv.exitCode !== 0) {
    console.error(
      `git mv ล้มเหลว (${mv.stderr.toString().trim()}) — ย้ายไม่สำเร็จ`,
    );
    process.exit(1);
  }

  // done/ เป็นพี่น้องกับ plan/ = ลึกเท่าเดิม ลิงก์ในไฟล์ยังชี้ถูกทุกเส้น ไม่ต้องแตะ
  // layout เก่า (plan/done/) ลึกขึ้น 1 ชั้น ถึงจะต้อง re-relativize
  const nested = dirname(doneDir) !== dirname(dir);
  const ownLinks = nested ? rewriteMovedFileLinks(dst, dir, doneDir) : 0;

  let inbound = 0;
  let inboundFiles = 0;
  for (const f of mdFiles(dir)) {
    if (f === dst) continue;
    const n = rewriteMarkdownLinks(f, src, dst);
    if (n) {
      inbound += n;
      inboundFiles++;
    }
  }

  console.log(`ย้าย ${rel(src)} → ${rel(dst)}`);
  console.log(
    nested
      ? `แก้ลิงก์ในไฟล์เอง: ${ownLinks}`
      : `แก้ลิงก์ในไฟล์เอง: 0 (ย้ายลึกเท่าเดิม ลิงก์เดิมยังถูก)`,
  );
  console.log(
    `แก้ inbound link: ${inbound} ลิงก์ ใน ${inboundFiles} ไฟล์ (สแกนแค่ ${rel(dir)}/**)`,
  );

  // log decision — record ship event (reuse existing kind, ไม่ต้อง schema ใหม่)
  const doneSpec = `${rel(dst)}`;
  put({
    id: nextId(rows()),
    kind: "decision",
    text: `${target} shipped → ${rel(dst)}`,
    spec: doneSpec,
  });
  // ponytail: decision นี้ *คือ* การย้ายเอง ไม่มีอะไรต้องเขียนกลับเข้า spec อีก — ไม่ mark synced
  // ทันที staleReport จะขึ้น "decision ยังไม่เข้า spec" ทุกครั้งที่ ship (เห็นจริงใน kickoff 2026-09-02)
  put({ kind: "synced", spec: doneSpec });

  // plain-text mention detection (detect-only, ไม่ auto-fix)
  let plainTextTotal = 0;
  const plainTextFiles: string[] = [];
  for (const f of mdFiles(dir)) {
    const n = countPlainTextMentions(f, target);
    if (n) {
      plainTextTotal += n;
      plainTextFiles.push(f.replace(`${dir}/`, ""));
    }
  }
  if (plainTextTotal > 0) {
    console.log(
      `⚠ plain-text mention ${plainTextTotal} จุด ใน ${plainTextFiles.length} ไฟล์ (ใน ${rel(dir)}/) — แก้เอง grep แล้วอัปเดต path:\n${plainTextFiles.join("\n")}`,
    );
  }

  // ไฟล์นอก plan/ ที่ mention target — detect-only
  const grep = Bun.spawnSync([
    "git",
    "grep",
    "-l",
    target,
    "--",
    rel(planBase),
    `:!${rel(dir)}`,
  ])
    .stdout.toString()
    .trim();
  if (grep)
    console.log(
      `⚠ ไฟล์นอก ${rel(dir)}/ ยังพูดถึง "${target}" — เช็คเอง (ไม่ auto-fix):\n${grep}`,
    );
};

// plan-check — list active PLANs + detect shipped-not-moved + broken links
// exit 0 = clean, 1 = issues found
export const cmdPlanCheck = (a: string[]) => {
  const quiet = a.includes("--quiet");
  const dir = planDir();
  if (!existsSync(dir)) {
    if (!quiet) console.log(`ไม่มี ${rel(dir)}/ — skip`);
    return;
  }

  const issues: string[] = [];

  // 1) List active PLANs
  const active = mdFiles(dir).filter((f) => !f.includes("/done/"));
  if (!quiet) {
    console.log(`${rel(dir)}/ — ${active.length} ไฟล์ (active)\n`);
  }

  // 2) Shipped-not-moved check
  const shipped = shippedNotMoved();
  for (const name of shipped) {
    issues.push(
      `${name} — shipped header แต่ยังไม่ย้าย\n   fix: ${planSweepCmd} ${name} --apply`,
    );
  }

  // 3) Broken link check — resolve [text](target) where target is in plan/**
  //    only check active files (not done/) — done/ files are historical snapshots with external refs
  const linkRe = /\]\(([^)]+)\)/g;
  for (const f of active) {
    // ตัด fenced block + inline code ทิ้งก่อน (แทนที่ด้วย spaces เพื่อคง line offset) —
    // ตัวอย่าง link ใน code (เช่น spec ของเครื่องมือนี้เอง) ต้องไม่ถูกนับเป็น link จริง
    const src = readFileSync(f, "utf8")
      .replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, " "))
      .replace(/`[^`\n]*`/g, (b) => " ".repeat(b.length));
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(src)) !== null) {
      const target = m[1];
      if (!target || /^(https?:|mailto:|\/)/.test(target)) continue;
      const [pathPart] = target.split("#");
      if (!pathPart) continue;
      const resolved = resolve(dirname(f), pathPart);
      if (!resolved.startsWith(dir)) continue; // only check links within plan/
      if (!existsSync(resolved)) {
        const rel = f.replace(`${dir}/`, "");
        const line = src.slice(0, m.index).split("\n").length;
        issues.push(
          `${rel}:${line} — broken link → ${target} (ไม่มีไฟล์นี้ใน plan/)\n   fix: แก้ path หรือสร้างไฟล์ที่ ref`,
        );
      }
    }
  }

  if (issues.length === 0) {
    if (!quiet) console.log("✅ clean");
    process.exit(0);
  }

  console.error(`🚨 ${issues.length} issue(s):\n`);
  for (let i = 0; i < issues.length; i++) {
    console.error(`${i + 1}. ${issues[i]}\n`);
  }
  process.exit(1);
};
