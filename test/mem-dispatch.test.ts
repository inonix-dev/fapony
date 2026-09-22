import { test } from "bun:test";
// test/mem-dispatch.test.ts — chunk 7 (PLAN-seed-and-surface, bug muc85pml):
// `fapony mem <typo>` must error, `fapony mem <plan>` must kickoff.
// classifyMemArg is the pure seam — these hit it directly so a future
// else-branch merge cannot silently rejoin bare + typo.

import assert from "node:assert";
import { classifyMemArg, MEM_SUBCOMMANDS } from "../src/mem/index.js";

const neverExists = (): boolean => false;
const alwaysExists = (): boolean => true;

test("testClassifyMemArgSubcommands", () => {
  for (const s of MEM_SUBCOMMANDS) {
    assert.equal(
      classifyMemArg(s, neverExists),
      "subcommand",
      `${s} dispatches, never falls through`,
    );
  }
  console.log("  ✓ classifyMemArg: every known subcommand dispatches");
});

test("testClassifyMemArgPlanPaths", () => {
  // .md suffix or a slash looks like a plan path — no store needed.
  assert.equal(classifyMemArg("PLAN-x.md", neverExists), "plan");
  assert.equal(classifyMemArg("plan/PLAN-x.md", neverExists), "plan");
  assert.equal(classifyMemArg(".fapony/plan/PLAN-x.md", neverExists), "plan");
  // A bare name that exists in planDir/doneDir is a plan too
  // (`fapony mem PLAN-x` without .md).
  assert.equal(classifyMemArg("PLAN-x", alwaysExists), "plan");
  assert.equal(classifyMemArg("PLAN-x", neverExists), "unknown");
  console.log("  ✓ classifyMemArg: plan paths route to kickoff");
});

test("testClassifyMemArgTypos", () => {
  // The bug itself: `now` advertised by a stale doc, no such subcommand.
  assert.equal(classifyMemArg("now", neverExists), "unknown");
  assert.equal(classifyMemArg("adn", neverExists), "unknown");
  // Prototype props are not subcommands (`"toString" in HELP` is true —
  // the lookup must not use `in`).
  assert.equal(classifyMemArg("toString", neverExists), "unknown");
  console.log("  ✓ classifyMemArg: typos are unknown, never kickoff");
});
