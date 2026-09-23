import { test } from "bun:test";
import assert from "node:assert";
import { BUG_MARKERS, hasBugMarker, isBugfixCommit } from "../../src/hook.js";

// --- Shared bug signalling (src/adapters/hooks/bug-markers.ts) ---

test("testHasBugMarkerFindsAnnouncementPhrases", () => {
  assert.strictEqual(
    hasBugMarker("ลอง check แล้ว เจอบั๊กจริงใน totalsRow"),
    "เจอบั๊ก",
  );
  assert.strictEqual(
    hasBugMarker("I found a bug in the totals row"),
    "found a bug",
  );
  assert.strictEqual(hasBugMarker("Bug: totals include tax twice"), "Bug:");
  console.log("  ✓ hasBugMarker finds Thai + English announcement phrases");
});

// Real misses/false fires measured on wt-vela, 551 sessions (mem key bug-marker-recall).
test("testHasBugMarkerCatchesMeasuredMisses", () => {
  for (const s of [
    "Found the real bug in the reducer",
    "พบว่าเป็นบั๊กจริงใน totals",
    "Bug confirmed and fixed",
    "Confirmed real bug in auth",
    "**Bug (สาเหตุที่ totals เพี้ยน):** tax counted twice",
    "บั๊กที่เจอระหว่างทาง: null guard",
    "ไม่พบบั๊กใหม่ แต่เจอบั๊กที่ totalsRow",
  ])
    assert.ok(hasBugMarker(s) !== null, `should fire: ${s}`);
  console.log("  ✓ hasBugMarker catches measured miss shapes");
});

test("testHasBugMarkerSkipsNegatedAndHypothetical", () => {
  for (const s of [
    "ไม่พบบั๊กใหม่ใน diff นี้",
    "นี่คือจุดที่จะเจอบั๊กจริง",
    "ไม่ใช่บั๊ก เป็น behavior ตั้งใจ",
    "ยังไม่เจอบั๊ก",
    "this is not a bug",
  ])
    assert.strictEqual(hasBugMarker(s), null, `should stay silent: ${s}`);
  console.log("  ✓ hasBugMarker skips negated/hypothetical phrasing");
});

test("testHasBugMarkerIgnoresSymptomWords", () => {
  assert.strictEqual(
    hasBugMarker("the value dies silently on the pre-existing path"),
    null,
    "symptom words must not fire — Stop hook blocks on a match",
  );
  assert.strictEqual(
    hasBugMarker("debug the output"),
    null,
    "debug is not a marker",
  );
  console.log("  ✓ hasBugMarker ignores symptom words (debug, silently)");
});

test("testBugMarkersIsDefinedAndNonEmpty", () => {
  assert.ok(BUG_MARKERS.length >= 2, "list must carry more than one language");
  for (const re of BUG_MARKERS) assert.ok(re instanceof RegExp);
  console.log("  ✓ BUG_MARKERS is an exported, multi-language list");
});

test("testIsBugfixCommitMatchesConventionalTypes", () => {
  assert.ok(isBugfixCommit("fix: correct totals"), "plain fix");
  assert.ok(
    isBugfixCommit("fix(debt): pair scope with scan root"),
    "scoped fix",
  );
  assert.ok(isBugfixCommit("fix!: drop legacy field"), "breaking fix");
  assert.ok(isBugfixCommit("bugfix(ui): guard null"), "bugfix alias");
  assert.ok(isBugfixCommit("hotfix: patch auth"), "hotfix alias");
  console.log(
    "  ✓ isBugfixCommit matches fix/bugfix/hotfix, scoped or breaking",
  );
});

test("testIsBugfixCommitRejectsNonBugTypesAndProse", () => {
  assert.ok(!isBugfixCommit("feat: add totals"), "feat is not a bug");
  assert.ok(!isBugfixCommit("chore: bump deps"), "chore is not a bug");
  assert.ok(!isBugfixCommit("pre-fix the cache"), "prose containing fix");
  assert.ok(
    !isBugfixCommit("fixes incoming requests"),
    "prefix must be a type token",
  );
  console.log("  ✓ isBugfixCommit rejects non-fix types and prose");
});
