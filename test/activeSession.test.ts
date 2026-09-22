import { test } from "bun:test";
// test/activeSession.test.ts — session-span inference (no I/O: pure selection)

import assert from "node:assert";
import type { SessionSpan } from "../src/session/index.js";
import { claudeProjectSlug, findSessionAt } from "../src/session/index.js";

function span(id: string, startMs: number, endMs: number): SessionSpan {
  return {
    sessionId: id,
    client: "opencode",
    worktree: "/wt",
    startMs,
    endMs,
  };
}

test("testFindSessionAt", () => {
  const wide = span("wide", 0, 1000);
  const narrow = span("narrow", 400, 600);
  const past = span("past", 2000, 3000);
  const spans = [wide, narrow, past];

  // Containment, not recency: `past` is the newest span but does not cover t.
  assert.equal(findSessionAt(spans, 100)?.sessionId, "wide");
  // Overlap → the narrower claim on that moment wins.
  assert.equal(findSessionAt(spans, 500)?.sessionId, "narrow");
  // Before every span → no guess at all (never fall back to "closest").
  assert.equal(findSessionAt(spans, -1), null);
  // Between spans, past the grace window → still no guess.
  assert.equal(findSessionAt(spans, 1500, 100), null);
  // Just after a span ends: the grace window covers a verdict that lands
  // before the client flushes its transcript.
  assert.equal(findSessionAt(spans, 1050, 100)?.sessionId, "wide");
  console.log("  ✓ findSessionAt picks the containing, narrowest span");
});

test("testClaudeProjectSlug", () => {
  assert.equal(
    claudeProjectSlug("/Users/me/Project/fapony/wt-fapony"),
    "-Users-me-Project-fapony-wt-fapony",
  );
  // Dots and underscores are non-alphanumeric too — all become '-'.
  assert.equal(claudeProjectSlug("/a/b.c_d"), "-a-b-c-d");
  console.log("  ✓ claudeProjectSlug matches Claude Code's dir naming");
});
