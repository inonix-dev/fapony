// test/hook/handoff.test.ts — PLAN-active-pain chunk 1: handoff enforcement.
import { test } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import type { MemRow } from "../../src/core/mem-log.js";
import {
  bugDedupeKey,
  countTicks,
  decideHandoff,
  handoffBlockMessage,
  handoffDedupeKey,
  hasHandoffLiteral,
  isPlanPath,
  memHasHandoffForPlan,
  mergeStopReasons,
  stopBlockedBefore,
  stopBlockPath,
  stopBlockSurface,
} from "../../src/hook.js";
import { withStateDir } from "./helpers.js";

const SINCE_MS = new Date("2026-09-23T10:00:00.000Z").getTime();
const REL = ".fapony/plan/PLAN-x.md";

function row(kind: string, ts: string, extra: Partial<MemRow> = {}): MemRow {
  return { ts, agent: "t", kind, text: "x", ...extra };
}

const BEFORE = `- [ ] chunk 1 — work
- [ ] handoff: write the note for chunk 2
`;
const AFTER_TICKED = `- [x] chunk 1 — work
- [ ] handoff: write the note for chunk 2
`;

test("testHandoffBlocksTickWithoutRow", () => {
  const d = decideHandoff({
    files: [{ rel: REL, before: BEFORE, after: AFTER_TICKED }],
    memRows: [],
    sinceMs: SINCE_MS,
  });
  assert.equal(d.blockedPlan, REL, "literal + new tick + no row must block");
  assert.deepEqual(d.evaluated, [REL]);
});

test("testHandoffPassesWithSpecRow", () => {
  const d = decideHandoff({
    files: [{ rel: REL, before: BEFORE, after: AFTER_TICKED }],
    memRows: [row("note", "2026-09-23T10:30:00.000Z", { spec: REL })],
    sinceMs: SINCE_MS,
  });
  assert.equal(d.blockedPlan, null, "note with spec pointing at plan passes");
});

test("testHandoffPassesWithFilesRow", () => {
  const d = decideHandoff({
    files: [{ rel: REL, before: BEFORE, after: AFTER_TICKED }],
    memRows: [row("next", "2026-09-23T11:00:00.000Z", { files: [REL] })],
    sinceMs: SINCE_MS,
  });
  assert.equal(
    d.blockedPlan,
    null,
    "next with files[] pointing at plan passes",
  );
});

test("testHandoffIgnoresStaleRows", () => {
  const d = decideHandoff({
    files: [{ rel: REL, before: BEFORE, after: AFTER_TICKED }],
    memRows: [row("note", "2026-09-23T09:59:59.000Z", { spec: REL })],
    sinceMs: SINCE_MS,
  });
  assert.equal(
    d.blockedPlan,
    REL,
    "a row older than session start is not a handoff",
  );
});

test("testHandoffIgnoresWrongKinds", () => {
  for (const kind of ["decision", "bug", "claim"]) {
    const d = decideHandoff({
      files: [{ rel: REL, before: BEFORE, after: AFTER_TICKED }],
      memRows: [row(kind, "2026-09-23T10:30:00.000Z", { spec: REL })],
      sinceMs: SINCE_MS,
    });
    assert.equal(
      d.blockedPlan,
      REL,
      `kind:${kind} must not satisfy the handoff (note/next only)`,
    );
  }
});

test("testHandoffPassesOldPlanWithoutLiteral", () => {
  const old = `- [x] chunk 1 — work\n`;
  const d = decideHandoff({
    files: [{ rel: REL, before: `- [ ] chunk 1 — work\n`, after: old }],
    memRows: [],
    sinceMs: SINCE_MS,
  });
  assert.equal(d.blockedPlan, null, "no literal = fail-open pass");
  assert.deepEqual(d.evaluated, [], "literal-less plans are not evaluated");
});

test("testHandoffPassesScopeEditWithoutNewTick", () => {
  const same = `- [ ] chunk 1 — scope text changed\n- [ ] handoff: write the note\n`;
  const d = decideHandoff({
    files: [{ rel: REL, before: BEFORE, after: same }],
    memRows: [],
    sinceMs: SINCE_MS,
  });
  assert.equal(d.blockedPlan, null, "scope edit with no new tick passes");
  // Literal present → evaluated (trial logs a pass, proving the gate ran).
  assert.deepEqual(d.evaluated, [REL]);
});

test("testHandoffCatchesCommittedTick", () => {
  // The chunk workflow commits the tick before the hook fires, so before/after
  // compare across the pre-session base — not diff HEAD. A ticked base with
  // no newer tick on disk is already-handed-off work, not a new close.
  const d = decideHandoff({
    files: [{ rel: REL, before: AFTER_TICKED, after: AFTER_TICKED }],
    memRows: [],
    sinceMs: SINCE_MS,
  });
  assert.equal(d.blockedPlan, null, "tick predating the session is not new");
});

test("testHandoffLiteralTickAloneDoesNotPass", () => {
  // Review finding 1: the ticked literal is cosmetic — only a mem row passes.
  const tickedLiteral = `- [x] chunk 1 — work\n- [x] handoff: note written\n`;
  assert.ok(hasHandoffLiteral(tickedLiteral), "ticked literal still opts in");
  const d = decideHandoff({
    files: [{ rel: REL, before: BEFORE, after: tickedLiteral }],
    memRows: [],
    sinceMs: SINCE_MS,
  });
  assert.equal(d.blockedPlan, REL, "ticked literal without a row still blocks");
});

test("testHandoffFirstBlockerWins", () => {
  const other = ".fapony/plan/PLAN-y.md";
  const d = decideHandoff({
    files: [
      { rel: REL, before: BEFORE, after: AFTER_TICKED },
      { rel: other, before: BEFORE, after: AFTER_TICKED },
    ],
    memRows: [],
    sinceMs: SINCE_MS,
  });
  assert.equal(d.blockedPlan, REL);
  assert.deepEqual(d.evaluated, [REL, other]);
});

test("testIsPlanPath", () => {
  assert.ok(isPlanPath(".fapony/plan/PLAN-x.md"));
  assert.ok(isPlanPath("./.fapony/plan/PLAN-x.md"));
  assert.ok(!isPlanPath(".fapony/done/PLAN-x.md"), "done/ is not gated");
  assert.ok(!isPlanPath(".fapony/spec/SPEC-x.md"), "spec/ is not gated");
  assert.ok(!isPlanPath(".fapony/plan/notes.txt"), "only .md");
  assert.ok(!isPlanPath("src/stop.ts"), "source is not gated");
});

test("testCountTicksAndLiteral", () => {
  assert.equal(countTicks(BEFORE), 0);
  assert.equal(countTicks(AFTER_TICKED), 1);
  assert.ok(hasHandoffLiteral(BEFORE), "unticked literal opts in");
  assert.ok(hasHandoffLiteral(AFTER_TICKED));
  assert.ok(!hasHandoffLiteral("- [x] chunk 1 — work\n"));
});

test("testHandoffBlockMessageNamesPlanAndCommand", () => {
  const msg = handoffBlockMessage(REL);
  assert.ok(msg.includes(REL), "message names the plan path");
  assert.ok(msg.includes("fapony mem add note"), "message gives the command");
  assert.ok(!/bun fapony\.ts/.test(msg), "repo-neutral: no runner prefix");
});

test("testMemHandoffMatchesBareBasename", () => {
  assert.ok(
    memHasHandoffForPlan(
      [row("note", "2026-09-23T10:30:00.000Z", { spec: "PLAN-x.md" })],
      REL,
      SINCE_MS,
    ),
    "a bare basename spec still names the plan",
  );
  assert.ok(
    !memHasHandoffForPlan(
      [
        row("note", "2026-09-23T10:30:00.000Z", {
          spec: ".fapony/plan/PLAN-other.md",
        }),
      ],
      REL,
      SINCE_MS,
    ),
    "a row for another plan does not satisfy",
  );
});

// Regression: a handoff block once fell into the shared commit dedupe and
// recorded kind:"commit" for a handoff block — spending the commit quota so
// the next commit-without-mem turn sailed through. mergeStopReasons keeps
// each kind on its own quota: this fails on the old single-variable shape.
test("testHandoffBlockNeverConsumesCommitQuota", () => {
  withStateDir(() => {
    const session = "/tmp/transcripts/sess-handoff-quota.jsonl";
    const wt = "/repo";
    // What cmdHookStop does on a handoff block: record kind handoff first…
    assert.equal(
      stopBlockedBefore(session, wt, "handoff"),
      false,
      "first handoff block goes through",
    );
    // …then merge with no commit reason competing.
    const merged = mergeStopReasons({
      commitReason: null,
      handoffReason: "Chunk ticked in .fapony/plan/PLAN-x.md …",
      session,
      worktree: wt,
      bugSignal: null,
    });
    assert.equal(merged, "Chunk ticked in .fapony/plan/PLAN-x.md …");
    const kinds = readFileSync(stopBlockPath(session), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { kind?: string }).kind ?? "commit");
    assert.deepEqual(
      kinds,
      ["handoff"],
      "merging a handoff reason must not write a commit row",
    );
  });
});

test("testMergePrefersCommitAndDedupesPerKind", () => {
  withStateDir(() => {
    const session = "/tmp/transcripts/sess-merge-prio.jsonl";
    const wt = "/repo";
    const first = mergeStopReasons({
      commitReason: "2 commits landed …",
      handoffReason: "Chunk ticked …",
      session,
      worktree: wt,
      bugSignal: null,
    });
    assert.equal(first, "2 commits landed …", "commit wins while fresh");
    // Repeating the same commit reason is deduped — and must NOT fall
    // through to handoff here either: the handoff path only offers its
    // reason when the commit path allowed the turn (its own quota, recorded
    // at creation). So a lone repeat allows.
    const second = mergeStopReasons({
      commitReason: "2 commits landed …",
      handoffReason: null,
      session,
      worktree: wt,
      bugSignal: null,
    });
    assert.strictEqual(second, null, "repeated commit reason allows");
    const kinds = readFileSync(stopBlockPath(session), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { kind?: string }).kind ?? "commit");
    assert.deepEqual(kinds, ["commit"], "one commit row, nothing else");
  });
});

test("testStopBlockSurfaceNamesTheFire", () => {
  assert.equal(stopBlockSurface(null), "commit-block");
  assert.equal(stopBlockSurface("เจอบั๊ก"), "bug-block");
  assert.equal(stopBlockSurface("found a bug"), "bug-block");
});

test("testHandoffDedupeKeyIsPerPlan", () => {
  withStateDir(() => {
    const session = "/tmp/transcripts/sess-handoff-perplan.jsonl";
    const wt = "/repo";
    const x = handoffDedupeKey(".fapony/plan/PLAN-x.md");
    const y = handoffDedupeKey(".fapony/plan/PLAN-y.md");
    assert.notEqual(x, y, "different plans are different problems");
    assert.equal(stopBlockedBefore(session, wt, x), false, "plan X blocks");
    assert.equal(stopBlockedBefore(session, wt, x), true, "plan X nags once");
    assert.equal(
      stopBlockedBefore(session, wt, y),
      false,
      "plan Y still surfaces — X must not spend Y's quota",
    );
  });
});

test("testBugDedupeKeyIsPerMarker", () => {
  withStateDir(() => {
    const session = "/tmp/transcripts/sess-bug-permarker.jsonl";
    const wt = "/repo";
    const a = bugDedupeKey("เจอบั๊ก");
    const b = bugDedupeKey("found a bug");
    assert.notEqual(a, b, "different markers are different problems");
    assert.equal(stopBlockedBefore(session, wt, a), false, "first bug blocks");
    assert.equal(stopBlockedBefore(session, wt, a), true, "same bug nags once");
    assert.equal(
      stopBlockedBefore(session, wt, b),
      false,
      "a different announced bug still surfaces",
    );
  });
});

test("testMergeRecordsPerMarkerBugQuota", () => {
  withStateDir(() => {
    const session = "/tmp/transcripts/sess-merge-marker.jsonl";
    const wt = "/repo";
    const merged = mergeStopReasons({
      commitReason: 'This turn reported a bug ("found a bug") …',
      handoffReason: null,
      session,
      worktree: wt,
      bugSignal: "found a bug",
    });
    assert.ok(merged, "bug reason goes through once");
    const kinds = readFileSync(stopBlockPath(session), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { kind?: string }).kind ?? "commit");
    assert.deepEqual(
      kinds,
      ["bug:found a bug"],
      "the row names the marker — a coarse 'bug' would spend every bug's quota",
    );
  });
});
