// commands/selftest.ts — fixture tests for selectors + plan-sweep link rewrite functions

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { claimsOf, openRows, rotateKeep } from "../selectors.js";
import type { LogRow } from "../store.js";
import {
  countPlainTextMentions,
  hasShippedHeader,
  rewriteMarkdownLinks,
  rewriteMovedFileLinks,
} from "./plan.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
};

// fixture helper — creates files in os.tmpdir(), auto-cleanup in finally
const makeFixture = (dir: string, name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

const runSelectorTests = () => {
  const t: LogRow[] = [
    { id: "a1", kind: "next", text: "work A", ts: "", agent: "" },
    { id: "a2", kind: "next", text: "work B", ts: "", agent: "" },
    { kind: "close", ref: "a2", text: "done", ts: "", agent: "" },
    { kind: "claim", ref: "a1", ts: "2026-01-01T00:00:00Z", agent: "agent-1" },
    // (1) claim เดียว → active
    { id: "a3", kind: "bug", text: "work C", ts: "", agent: "" },
    { kind: "claim", ref: "a3", ts: "2026-01-01T01:00:00Z", agent: "agent-1" },
    {
      kind: "release",
      ref: "a3",
      text: "paused",
      ts: "2026-01-01T02:00:00Z",
      agent: "agent-1",
    },
    // (2) release → inactive
    { id: "a4", kind: "next", text: "work D", ts: "", agent: "" },
    { kind: "claim", ref: "a4", ts: "2026-01-01T03:00:00Z", agent: "agent-2" },
    { kind: "close", ref: "a4", text: "shipped", ts: "", agent: "" },
    // (3) claim+close → inactive
    { id: "a5", kind: "next", text: "work E", ts: "", agent: "" },
    { kind: "claim", ref: "a5", ts: "2026-01-01T04:00:00Z", agent: "agent-1" },
    { kind: "claim", ref: "a5", ts: "2026-01-01T05:00:00Z", agent: "agent-3" },
    // (4) double claim → หลังชนะ (agent-3)
  ];

  const claims = claimsOf(t);
  const open = openRows(t);

  // (1) a1 claim → active
  assert(
    claims.has("a1") && claims.get("a1")?.agent === "agent-1",
    "claim active is wrong",
  );
  // (2) a3 release → inactive
  assert(!claims.has("a3"), "release did not void the claim");
  // (3) a4 close → inactive
  assert(!claims.has("a4"), "close void claim");
  // (4) a5 double claim → agent-3 ชนะ
  assert(
    claims.has("a5") && claims.get("a5")?.agent === "agent-3",
    "double claim after the winner",
  );
  // a2 closed → ไม่ควรอยู่ใน open
  assert(!open.some((r) => r.id === "a2"), "tombstone broken");
  // open = a1, a3 (released but still open), a5
  assert(
    open
      .map((r) => r.id)
      .sort()
      .join() === "a1,a3,a5",
    "open rows are wrong",
  );
};

const runRotateTests = () => {
  const t: LogRow[] = [
    { id: "r1", kind: "next", text: "keep me", ts: "", agent: "" },
    { kind: "claim", ref: "r1", ts: "2026-01-01T00:00:00Z", agent: "agent-1" },
    // r1: open + claimed → work row + claim row ต้องเก็บทั้งคู่

    { id: "r2", kind: "bug", text: "closed already", ts: "", agent: "" },
    { kind: "claim", ref: "r2", ts: "2026-01-01T00:00:00Z", agent: "agent-1" },
    { kind: "close", ref: "r2", text: "shipped", ts: "", agent: "" },
    // r2: ปิดแล้ว → work row, claim row, close tombstone ทิ้งหมด

    {
      id: "r3",
      kind: "decision",
      text: "resolved decision",
      ts: "2026-01-01T00:00:00Z",
      agent: "",
      spec: "PLAN-a.md",
    },
    {
      kind: "synced",
      spec: "PLAN-a.md",
      ts: "2026-01-02T00:00:00Z",
      agent: "",
    },
    // r3: spec synced *หลัง* decision นี้ → resolved แล้ว archive ได้

    {
      id: "r4",
      kind: "decision",
      text: "still relevant decision",
      ts: "2026-01-03T00:00:00Z",
      agent: "",
      spec: "PLAN-a.md",
    },
    // r4: decision ใหม่กว่า synced ล่าสุด → ยังไม่ resolved เก็บไว้

    { id: "r5", kind: "note", text: "note no spec", ts: "", agent: "" },
    // r5: note ไม่มี spec → ไม่มีทางรู้ resolved หรือยัง เก็บไว้เสมอ
  ];

  const kept = rotateKeep(t);
  assert(
    kept.some((r) => "id" in r && r.id === "r1" && r.kind === "next"),
    "rotateKeep: must keep an open work row",
  );
  assert(
    kept.some((r) => r.kind === "claim" && "ref" in r && r.ref === "r1"),
    "rotateKeep: must keep an active claim on an open row",
  );
  assert(
    !kept.some((r) => "id" in r && r.id === "r2"),
    "rotateKeep: must not keep a closed work row",
  );
  assert(
    !kept.some((r) => r.kind === "claim" && "ref" in r && r.ref === "r2"),
    "rotateKeep: must not keep a claim on a closed ref",
  );
  assert(
    !kept.some((r) => r.kind === "close"),
    "rotateKeep: must not keep a close tombstone",
  );
  assert(
    !kept.some((r) => "id" in r && r.id === "r3"),
    "rotateKeep: decision whose spec synced afterwards is resolved — drop it",
  );
  assert(
    kept.some((r) => "id" in r && r.id === "r4"),
    "rotateKeep: decision newer than the last sync is still relevant — keep it",
  );
  assert(
    kept.some((r) => "id" in r && r.id === "r5"),
    "rotateKeep: a note with no spec is always kept",
  );
};

const runPlanSweepTests = () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mem-test-"));
  try {
    // === Case A: rewriteMarkdownLinks + countPlainTextMentions ===
    // สร้าง fixture: ไฟล์ที่ reference ไปที่ plan/PLAN-page-style.md หลายแบบ
    const planDir = join(tmpDir, "plan");
    const doneDir = join(tmpDir, "plan", "done");
    mkdirSync(planDir, { recursive: true });
    mkdirSync(doneDir, { recursive: true });

    // "old" file — จำลอง apps/vela/plan/PLAN-page-style.md (touch only)
    const oldFile = join(planDir, "PLAN-page-style.md");
    writeFileSync(oldFile, "# PLAN-page-style\n");

    // inbound file — จำลอง apps/vela/plan/PLAN-people-style.md
    const inbound = [
      "# PLAN-people-style — refs",
      "",
      "[txt](PLAN-page-style.md)", // markdown link → should be rebased
      "look at PLAN-page-style.md for details", // plain text → detect only
      "`PLAN-page-style.md` in backtick", // backtick → detect only
      "```",
      "PLAN-page-style.md", // code fence → detect only
      "```",
      "see PLAN-page-style §1.5 for tone", // bare (no .md) with section ref → detect only
    ].join("\n");
    const inboundFile = join(planDir, "PLAN-people-style.md");
    writeFileSync(inboundFile, inbound);

    // A1: rewriteMarkdownLinks — rebase markdown link [txt](PLAN-page-style.md) → [txt](../done/PLAN-page-style.md)
    const oldAbs = join(planDir, "PLAN-page-style.md");
    const newAbs = join(doneDir, "PLAN-page-style.md");
    const mdCount = rewriteMarkdownLinks(inboundFile, oldAbs, newAbs);
    assert(
      mdCount === 1,
      `rewriteMarkdownLinks should fix 1 markdown link, got ${mdCount}`,
    );

    // A2: countPlainTextMentions — should detect all plain text variants (not markdown links)
    const ptCount = countPlainTextMentions(inboundFile, "PLAN-page-style.md");
    // after rewriteMarkdownLinks, the markdown link is now [txt](../done/...) — no longer a plain text match
    // remaining: plain text (line 3), backtick (line 4), code fence (line 6), bare with § (line 8) = 4
    assert(ptCount === 4, `countPlainTextMentions should be 4, got ${ptCount}`);

    // A3: assert file content — markdown link was rebased, plain text untouched
    const afterA = readFileSync(inboundFile, "utf8");
    assert(
      afterA.includes("[txt](done/PLAN-page-style.md)"),
      "markdown link should be rebased to done/",
    );
    assert(
      afterA.includes("look at PLAN-page-style.md for details"),
      "plain text should remain unchanged",
    );
    assert(
      afterA.includes("`PLAN-page-style.md` in backtick"),
      "backtick should remain unchanged",
    );
    assert(
      afterA.includes("see PLAN-page-style §1.5 for tone"),
      "bare name with § should remain unchanged",
    );

    // === Case B: rewriteMovedFileLinks — file moved, target stayed in old dir ===
    // Create sibling file in planDir (stayed behind when main file moved to doneDir)
    makeFixture(planDir, "PLAN-nav.md", "# PLAN-nav\n");
    const movedFile = join(doneDir, "PLAN-page-style.md");
    writeFileSync(
      movedFile,
      [
        "# PLAN-page-style",
        "[sibling](PLAN-nav.md)", // sibling in old dir → rebase to ../
        "[external](https://example.com)", // external → skip
      ].join("\n"),
    );

    const movedCount = rewriteMovedFileLinks(movedFile, planDir, doneDir);
    assert(
      movedCount === 1,
      `rewriteMovedFileLinks should fix 1 link, got ${movedCount}`,
    );

    const afterB = readFileSync(movedFile, "utf8");
    assert(
      afterB.includes("[sibling](../PLAN-nav.md)"),
      "sibling link should rebase to ../PLAN-nav.md (target stayed in plan/)",
    );
    assert(
      afterB.includes("[external](https://example.com)"),
      "external link should be untouched",
    );

    // === Case B2: rewriteMovedFileLinks — both source and target in same dir after move ===
    // This is the actual bug: when both files move from plan/ to plan/done/, the outbound
    // link should be same-dir relative (just the filename), not ../filename
    makeFixture(doneDir, "PLAN-page-style.md", "# PLAN-page-style\n");
    const movedFile2 = join(doneDir, "PLAN-people-style.md");
    writeFileSync(
      movedFile2,
      [
        "# PLAN-people-style",
        "[page](PLAN-page-style.md)", // target also in done/ → same-dir relative
        "[nav](PLAN-nav.md)", // target stayed in plan/ → ../
      ].join("\n"),
    );

    const movedCount2 = rewriteMovedFileLinks(movedFile2, planDir, doneDir);
    assert(
      movedCount2 === 2,
      `rewriteMovedFileLinks B2 should fix 2 links, got ${movedCount2}`,
    );

    const afterB2 = readFileSync(movedFile2, "utf8");
    assert(
      afterB2.includes("[page](PLAN-page-style.md)"),
      "B2: same-dir link should stay as filename (both in done/)",
    );
    assert(
      afterB2.includes("[nav](../PLAN-nav.md)"),
      "B2: cross-dir link should rebase to ../ (target stayed in plan/)",
    );

    // === Case C: countPlainTextMentions edge case — bare name (no .md) ===
    const edgeFile = join(tmpDir, "edge.md");
    writeFileSync(edgeFile, "see PLAN-page-style for details\n");
    const edgeCount = countPlainTextMentions(edgeFile, "PLAN-page-style.md");
    assert(
      edgeCount === 1,
      `bare PLAN-page-style (no .md) should count = 1, got ${edgeCount}`,
    );

    // edge: no match
    const noMatchFile = join(tmpDir, "nomatch.md");
    writeFileSync(noMatchFile, "nothing here about plans\n");
    const noCount = countPlainTextMentions(noMatchFile, "PLAN-page-style.md");
    assert(noCount === 0, `no match should return 0, got ${noCount}`);

    // === Case D: regex fix — path-prefixed mentions (§1 root cause fix) ===
    const d1 = join(tmpDir, "d1.md");
    writeFileSync(d1, "`done/PLAN-page-style.md`");
    assert(
      countPlainTextMentions(d1, "PLAN-page-style.md") === 1,
      "D1: backtick with path prefix should detect (was 0 before fix)",
    );

    const d2 = join(tmpDir, "d2.md");
    writeFileSync(d2, "apps/vela/plan/PLAN-page-style.md");
    assert(
      countPlainTextMentions(d2, "PLAN-page-style.md") === 1,
      "D2: plain text with path prefix should detect (was 0 before fix)",
    );

    const d3 = join(tmpDir, "d3.md");
    writeFileSync(d3, "[x](PLAN-page-style.md)");
    assert(
      countPlainTextMentions(d3, "PLAN-page-style.md") === 0,
      "D3: markdown link should not double-count",
    );

    const d4 = join(tmpDir, "d4.md");
    writeFileSync(d4, "done/PLAN-page-style.md and `PLAN-page-style.md`");
    assert(
      countPlainTextMentions(d4, "PLAN-page-style.md") === 2,
      "D4: multiple mentions with path prefix should count all",
    );

    // D5: regression guard — markdown link whose display text equals the target filename
    // (actual repo convention, e.g. [PLAN-page-style.md](../done/PLAN-page-style.md)) must NOT
    // be double-counted as a plain-text mention — first attempt at this fix only stripped the
    // `(target)` part and left `[display-text]` unguarded, miscounting every such link
    const d5 = join(tmpDir, "d5.md");
    writeFileSync(
      d5,
      "see [PLAN-page-style.md](../done/PLAN-page-style.md) §1.5.4 for tone",
    );
    assert(
      countPlainTextMentions(d5, "PLAN-page-style.md") === 0,
      "D5: markdown link with matching display text should not double-count",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

const runPlanCheckTests = () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mem-pc-"));
  try {
    const planDir = join(tmpDir, "plan");
    const doneDir = join(planDir, "done");
    mkdirSync(doneDir, { recursive: true });

    // E1: shipped-not-moved detection
    writeFileSync(
      join(planDir, "PLAN-shipped.md"),
      "> ✅ **Scope:** test\n# shipped plan\n",
    );
    writeFileSync(join(planDir, "PLAN-active.md"), "# active plan\n");

    // plan ที่เขียนด้วย format ปัจจุบัน: frontmatter + title มาก่อน header ✅ shipped
    writeFileSync(
      join(planDir, "PLAN-frontmatter.md"),
      "---\nkind: unit\n---\n\n# shipped with frontmatter\n\n> ✅ **shipped 2026-09-13** (abc1234)\n",
    );

    const mdFilesLocal = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory()
              ? mdFilesLocal(join(dir, e.name))
              : e.name.endsWith(".md")
                ? [join(dir, e.name)]
                : [],
          )
        : [];

    const activeFiles = mdFilesLocal(planDir).filter(
      (f) => !f.includes("/done/"),
    );
    const shipped = activeFiles.filter(hasShippedHeader);
    assert(
      shipped.length === 2,
      `E1: should find 2 shipped-not-moved, got ${shipped.length}`,
    );
    assert(
      shipped.some((f) => f.includes("PLAN-shipped.md")),
      "E1: should detect PLAN-shipped.md",
    );
    assert(
      shipped.some((f) => f.includes("PLAN-frontmatter.md")),
      "E1: header below frontmatter + title must still count as shipped",
    );

    // E2: broken link detection
    writeFileSync(
      join(planDir, "PLAN-broken.md"),
      "# broken\n[ref](PLAN-notexist.md)\n",
    );
    const allFiles = mdFilesLocal(planDir);
    const linkRe = /\]\(([^)]+)\)/g;
    const broken: string[] = [];
    for (const f of allFiles) {
      const src = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(src)) !== null) {
        const target = m[1];
        if (!target || /^(https?:|mailto:|\/)/.test(target)) continue;
        const [pathPart] = target.split("#");
        if (!pathPart) continue;
        const resolved = resolve(dirname(f), pathPart);
        if (!resolved.startsWith(planDir)) continue;
        if (!existsSync(resolved)) {
          broken.push(`${f} → ${target}`);
        }
      }
    }
    assert(
      broken.length === 1,
      `E2: should find 1 broken link, got ${broken.length}`,
    );
    assert(
      broken[0]?.includes("PLAN-notexist.md") === true,
      "E2: broken link should reference PLAN-notexist.md",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

export const cmdTest = () => {
  runSelectorTests();
  runRotateTests();
  runPlanSweepTests();
  runPlanCheckTests();
  console.log("ok");
};
