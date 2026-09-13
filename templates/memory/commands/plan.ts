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
import { doneDir, memCmd, nextId, planDir, put, rel, rows } from "../store.js";

const SHIPPED = /^>\s*✅/m;

// header ✅ shipped ไม่ได้อยู่บรรทัดแรกอีกแล้ว — plan format ปัจจุบันขึ้นต้นด้วย frontmatter
// แล้วตามด้วย `# title` (ดู templates/PLAN.md) เช็กหัวไฟล์แทนที่จะเช็กบรรทัดแรกบรรทัดเดียว
export const hasShippedHeader = (file: string): boolean =>
  SHIPPED.test(readFileSync(file, "utf8").slice(0, 2048));

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
  const dir = planDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .filter((name) => hasShippedHeader(join(dir, name)));
};

export const cmdPlanSweep = (a: string[]) => {
  const dir = planDir;
  if (!existsSync(dir)) {
    console.log(`no ${rel(dir)}/ — nothing to sweep`);
    return;
  }
  const candidates = shippedNotMoved();

  const target = a.find((x) => x.endsWith(".md"));
  const apply = a.includes("--apply");

  if (!target) {
    if (!candidates.length) {
      console.log(
        `no PLAN with a ✅ shipped header is sitting outside ${rel(doneDir)}/`,
      );
      return;
    }
    const all = rows();
    console.log(
      `# plan-sweep — ${candidates.length} file(s) marked shipped but not archived\n`,
    );
    for (const name of candidates) {
      const spec = `${rel(dir)}/${name}`;
      const openN = openRows(all).filter((r) => r.spec === spec).length;
      const warn = openN
        ? `  ⚠ ${openN} open row(s) (next/bug/hold/decision/note) — check before moving`
        : "";
      console.log(`- ${rel(dir)}/${name}${warn}`);
    }
    console.log(`\nmove: ${planSweepCmd} <file.md> --apply`);
    return;
  }

  const src = join(dir, target);
  if (!existsSync(src)) {
    console.error(`${rel(src)} not found`);
    process.exit(1);
  }
  const shipped = hasShippedHeader(src);
  if (!apply) {
    console.log(
      shipped
        ? `${target}: has a ✅ shipped header — ready to move (add --apply)`
        : `${target}: no ✅ shipped header at the top — check the whole file is actually done`,
    );
    return;
  }

  // ponytail: --apply เดิม (ก่อนหน้านี้) ไม่บังคับ 2 เงื่อนไขนี้เลย — ผ่าน dry-run message ได้ก็จริง
  // แต่รัน --apply ตรง ๆ ข้ามได้หมด → เสี่ยงเวลา agent ship เองอัตโนมัติไม่มีคนเช็ค แก้เป็น hard block
  if (!shipped && !process.env.MEM_FORCE) {
    console.error(
      `${target}: no ✅ shipped header at the top — refusing to move (MEM_FORCE=1 to override)`,
    );
    process.exit(1);
  }
  const openSpec = `${rel(dir)}/${target}`;
  const openN = openRows(rows()).filter((r) => r.spec === openSpec);
  if (openN.length && !process.env.MEM_FORCE) {
    console.error(
      `${target}: still has ${openN.length} open row(s) (next/bug/hold/decision/note) — close them or move the spec first (MEM_FORCE=1 to override):\n` +
        openN.map((r) => `  [${r.id}] ${r.kind} ${r.text}`).join("\n"),
    );
    process.exit(1);
  }

  const dst = join(doneDir, target);
  if (existsSync(dst)) {
    console.error(`${rel(dst)} already exists`);
    process.exit(1);
  }

  // ponytail: ไฟล์ที่เพิ่งเขียนในรอบนี้อาจยังไม่ git add — `git mv` fail แบบเงียบ (exit 128, ไม่ throw)
  // แล้วโค้ดต่อไปพัง ENOENT ตอนอ่าน dst ที่ไม่มีจริง — stage ก่อนเสมอ (no-op ถ้า track อยู่แล้ว)
  mkdirSync(doneDir, { recursive: true });
  Bun.spawnSync(["git", "add", src]);
  const mv = Bun.spawnSync(["git", "mv", src, dst]);
  if (mv.exitCode !== 0) {
    console.error(`git mv failed (${mv.stderr.toString().trim()}) — not moved`);
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

  console.log(`moved ${rel(src)} → ${rel(dst)}`);
  console.log(
    nested
      ? `links rewritten inside the file: ${ownLinks}`
      : `links rewritten inside the file: 0 (same depth, existing links still resolve)`,
  );
  console.log(
    `inbound links rewritten: ${inbound} in ${inboundFiles} file(s) (scanned ${rel(dir)}/** only)`,
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
      `⚠ ${plainTextTotal} plain-text mention(s) in ${plainTextFiles.length} file(s) under ${rel(dir)}/ — grep and update the paths yourself:\n${plainTextFiles.join("\n")}`,
    );
  }

  // ไฟล์นอก plan/ ที่ mention target — detect-only
  const grep = Bun.spawnSync([
    "git",
    "grep",
    "-l",
    target,
    "--",
    // ขอบเขต "ไฟล์นอก plan/" = โฟลเดอร์ที่ plan/ อยู่ใต้มัน (apps/vela, .fapony, …)
    rel(dirname(planDir)),
    `:!${rel(dir)}`,
  ])
    .stdout.toString()
    .trim();
  if (grep)
    console.log(
      `⚠ files outside ${rel(dir)}/ still mention "${target}" — check them yourself (not auto-fixed):\n${grep}`,
    );
};

// plan-check — list active PLANs + detect shipped-not-moved + broken links
// exit 0 = clean, 1 = issues found
export const cmdPlanCheck = (a: string[]) => {
  const quiet = a.includes("--quiet");
  const dir = planDir;
  if (!existsSync(dir)) {
    if (!quiet) console.log(`no ${rel(dir)}/ — skip`);
    return;
  }

  const issues: string[] = [];

  // 1) List active PLANs
  const active = mdFiles(dir).filter((f) => !f.includes("/done/"));
  if (!quiet) {
    console.log(`${rel(dir)}/ — ${active.length} file(s) (active)\n`);
  }

  // 2) Shipped-not-moved check
  const shipped = shippedNotMoved();
  for (const name of shipped) {
    issues.push(
      `${name} — has a shipped header but was never archived\n   fix: ${planSweepCmd} ${name} --apply`,
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
          `${rel}:${line} — broken link → ${target} (no such file in plan/)\n   fix: correct the path or create the file it points at`,
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
