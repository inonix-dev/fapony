// selectors.ts — derive open/claimed/stale views from the append-only log

import type {
  ClaimRow,
  CloseRow,
  LogRow,
  ReleaseRow,
  WorkRow,
} from "./store.js";

// ponytail: reducer = filter + tombstone set. 50k บรรทัด = 9.6MB/26ms — ไฟล์ไม่ใช่คอขวด
// เพดานจริง = แถวที่ยังเปิดเยอะจน view อ่านไม่รู้เรื่อง → ตอนนั้นค่อย rotate: git mv + append openRows(เก่า) ลงไฟล์ใหม่
export const openRows = (all: LogRow[]): WorkRow[] => {
  const dead = new Set(
    all.filter((r): r is CloseRow => r.kind === "close").map((r) => r.ref),
  );
  return all.filter(
    (r): r is WorkRow =>
      r.kind !== "close" &&
      r.kind !== "claim" &&
      r.kind !== "release" &&
      r.kind !== "synced" &&
      "id" in r &&
      !dead.has(r.id),
  );
};

// C) claimsOf: คืน Map ref → latest claim row ที่ยัง active
// active = แถวล่าสุดของ claim|release เป็น claim และ ref ไม่อยู่ใน dead (close)
export const claimsOf = (all: LogRow[]): Map<string, ClaimRow> => {
  const dead = new Set(
    all.filter((r): r is CloseRow => r.kind === "close").map((r) => r.ref),
  );
  const latest = new Map<string, ClaimRow | ReleaseRow>();
  for (const r of all) {
    if (r.kind === "claim" || r.kind === "release") {
      latest.set(r.ref, r);
    }
  }
  const active = new Map<string, ClaimRow>();
  for (const [ref, r] of latest) {
    if (r.kind === "claim" && !dead.has(ref)) {
      active.set(ref, r);
    }
  }
  return active;
};

// decision ที่ใหม่กว่าทั้ง commit ล่าสุดของ spec และ synced marker = spec ยังไม่ได้อัปเดตตาม
// + next/hold ที่มี spec ถูกแก้หลังสร้าง = อาจปิดไปแล้วแต่ไม่มีใคร close — เคสจริง: msbnndmt
// + active claim ที่อายุเกิน 4 ชม. = agent อาจตายกลางงาน
export const staleReport = (all: LogRow[]): string[] => {
  const out: string[] = [];
  const mark: Record<string, number> = {};
  for (const r of all) {
    if (r.kind === "synced") mark[r.spec] = Date.parse(r.ts);
  }

  // batch: collect unique spec paths, spawn one git per path
  const specPaths = new Set<string>();
  for (const r of all) {
    if (r.kind === "decision" && r.spec) specPaths.add(r.spec);
  }
  for (const r of openRows(all)) {
    if ((r.kind === "next" || r.kind === "hold") && r.spec)
      specPaths.add(r.spec);
  }
  const gitDates = new Map<string, number>();
  for (const spec of specPaths) {
    // --follow: spec path ที่ถูก git mv (เช่น ย้ายเข้า plan/done/) ยังตามประวัติต่อได้
    const git = Bun.spawnSync([
      "git",
      "log",
      "-1",
      "--follow",
      "--format=%cI",
      "--",
      spec,
    ])
      .stdout.toString()
      .trim();
    if (git) gitDates.set(spec, Date.parse(git));
  }

  for (const r of all) {
    if (r.kind === "decision" && r.spec) {
      const base = Math.max(gitDates.get(r.spec) ?? 0, mark[r.spec] ?? 0);
      if (base < Date.parse(r.ts))
        out.push(
          `STALE ${r.spec}: decision ${r.ts.slice(0, 10)} never made it into the spec — "${r.text}"`,
        );
    }
  }
  for (const r of openRows(all)) {
    if ((r.kind === "next" || r.kind === "hold") && r.spec) {
      const gitDate = gitDates.get(r.spec);
      // ponytail: grace 24 ชม. — "log next แล้วเขียน/commit plan ต่อในวันเดียวกัน" คือ workflow ปกติ
      // ไม่ใช่สัญญาณว่างานจบแล้วลืมปิด (เคสจริงที่ต้องจับอย่าง msbnndmt ห่างกันเป็นวัน) —
      // ไม่มี grace = SUSPECT ขึ้นทุกแผนที่เพิ่งเขียน แล้วทุกคนเรียนรู้ที่จะเลื่อนผ่าน stale ทั้งบล็อก
      if (gitDate && gitDate > Date.parse(r.ts) + 86_400_000)
        out.push(
          `SUSPECT [${r.id}] ${r.spec} changed after this ${r.kind} (${r.ts.slice(0, 10)}) — check whether it is already done`,
        );
    }
  }
  const claims = claimsOf(all);
  for (const [ref, c] of claims) {
    const ageH = (Date.now() - Date.parse(c.ts)) / 3_600_000;
    if (ageH > 4) {
      out.push(
        `SUSPECT claim [${ref}] by ${c.agent} ${c.ts.slice(0, 10)} never closed/released — the agent may have died mid-task`,
      );
    }
  }
  return out;
};

// rotate: แถวที่ต้องแบกต่อในไฟล์ log ใหม่หลัง archive
// - next/bug/hold ที่ยังเปิด + claim ที่ยัง active อยู่บนแถวนั้น (close/claim ของ ref ที่ปิดแล้ว = ทิ้งได้)
// - decision/note ยังไม่มี "close" ของตัวเอง (ประวัติถาวรตามดีไซน์) แต่ resolved ได้ทางอ้อมผ่าน synced:
//   spec ถูก synced *หลัง* แถวนี้แล้ว = ข้อมูลเข้า spec แล้วจริง เก็บใน archive (git) พอ ไม่ต้องแบกในไฟล์ hot
//   (logic เดียวกับ staleReport's decision check — ไม่มี spec หรือยังไม่ synced ทันแถวนี้ = ยังถือว่า relevant, เก็บไว้)
// ponytail: decision/note ที่ไม่มี spec ไม่มีทางรู้ว่า resolved แล้วหรือยัง — เก็บไว้ตลอด (เพดานจริงคือ
// ต้อง attach spec ตั้งแต่ log ถ้าอยากให้ rotate ออกได้ในอนาคต ไม่ใช่ปัญหาของ rotate เอง)
export const rotateKeep = (all: LogRow[]): LogRow[] => {
  const open = openRows(all);
  const workOpen = open.filter(
    (r) => r.kind === "next" || r.kind === "bug" || r.kind === "hold",
  );
  const claims = claimsOf(all);
  const openIds = new Set(workOpen.map((r) => r.id));
  const keepClaims = [...claims.values()].filter((c) => openIds.has(c.ref));

  const syncedAt: Record<string, number> = {};
  for (const r of all)
    if (r.kind === "synced") syncedAt[r.spec] = Date.parse(r.ts);
  const keepDecisionNote = open.filter(
    (r) =>
      (r.kind === "decision" || r.kind === "note") &&
      (!r.spec || !(r.spec in syncedAt) || syncedAt[r.spec] < Date.parse(r.ts)),
  );

  return [...workOpen, ...keepDecisionNote, ...keepClaims];
};
