import { test } from "bun:test";

// test/session/opencode.test.ts — OpenCode session usage tests

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { readPassiveUsage } from "../../src/session/index.js";
import { withEnv, withFixtureDb } from "./helpers.js";

test("testSessionDefaultHasNoDetail", () => {
  withFixtureDb((dbPath) =>
    withEnv("FAPONY_OPENCODE_DB", dbPath, () => {
      const r = readPassiveUsage();
      assert.equal(r.session_count, 2);
      assert.equal(r.total_tokens_input, 300);
      assert.equal(r.detail, undefined, "default must not include detail");
    }),
  );
  console.log("  ✓ readPassiveUsage default has no detail (additive)");
});

test("testSessionWorktreeScopeUsesSessionDirectory", () => {
  withFixtureDb((dbPath) =>
    withEnv("FAPONY_OPENCODE_DB", dbPath, () => {
      const sub = readPassiveUsage("/tmp/wt1/wt-sub");
      assert.equal(sub.session_count, 1);
      assert.equal(sub.total_tokens_input, 100);
      const root = readPassiveUsage("/tmp/wt1");
      assert.equal(root.session_count, 1);
      assert.equal(root.total_tokens_input, 200);
    }),
  );
  console.log(
    "  \u2713 readPassiveUsage scopes by session.directory, not project root",
  );
});

test("testSessionDetailBreakdown", () => {
  withFixtureDb((dbPath) =>
    withEnv("FAPONY_OPENCODE_DB", dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      assert.equal(r.session_count, 2);
      assert.equal(r.total_tokens_input, 300);
      assert.ok(r.detail, "detail:true must include detail");
      assert.deepEqual(r.detail.tool_breakdown, { read: 3, bash: 1 });
      assert.equal(r.detail.steps, 3);
      assert.equal(r.detail.by_session.length, 2);
      const s1 = r.detail.by_session.find((s) => s.session_id === "s1")!;
      assert.equal(s1.steps, 2);
      assert.deepEqual(s1.tools, { read: 2, bash: 1 });
      const s2 = r.detail.by_session.find((s) => s.session_id === "s2")!;
      assert.equal(s2.steps, 1);
      assert.deepEqual(s2.tools, { read: 1 });
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail: tool breakdown + steps per session",
  );
});

test("testSessionDetailBytesByTool", () => {
  withFixtureDb((dbPath) =>
    withEnv("FAPONY_OPENCODE_DB", dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      assert.ok(r.detail, "detail present");
      assert.deepEqual(r.detail!.bytes_by_tool, { read: 18 });
      console.log(
        "  ✓ readPassiveUsage detail → bytes_by_tool from state.output",
      );
    }),
  );
});

test("testSessionDetailSkipsUnknownType", () => {
  withFixtureDb((dbPath) =>
    withEnv("FAPONY_OPENCODE_DB", dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      const blob = JSON.stringify(r.detail);
      assert(!blob.includes("hello"), "unknown part content must not leak");
      assert(
        !blob.includes("file contents here"),
        "tool input/output must never be stored",
      );
      assert(!("text" in r.detail!.tool_breakdown), "text is not a tool");
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail skips unknown types, never stores I/O",
  );
});

test("testSessionDetailStepTokensNotSummed", () => {
  withFixtureDb((dbPath) =>
    withEnv("FAPONY_OPENCODE_DB", dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      const blob = JSON.stringify(r.detail);
      assert(!blob.includes("19000") && !blob.includes("19500"));
      assert(!blob.includes("57500"), "no step-token sum anywhere");
      assert(typeof r.detail!.note === "string" && r.detail!.note.length > 0);
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail reports step counts, never token sums",
  );
});

test("testSessionDetailMatchesRawSql", () => {
  withFixtureDb((dbPath) =>
    withEnv("FAPONY_OPENCODE_DB", dbPath, () => {
      const raw = new Database(dbPath, { readonly: true });
      try {
        const expected = raw
          .prepare(
            `SELECT json_extract(data,'$.tool') AS tool, COUNT(*) AS c FROM part WHERE json_extract(data,'$.type')='tool' GROUP BY tool ORDER BY c DESC`,
          )
          .all() as Array<{ tool: string; c: number }>;
        const r = readPassiveUsage(undefined, undefined, undefined, true);
        for (const e of expected) {
          assert.equal(
            r.detail!.tool_breakdown[e.tool],
            e.c,
            `tool ${e.tool} matches raw SQL`,
          );
        }
        const steps = raw
          .prepare(
            `SELECT COUNT(*) AS n FROM part WHERE json_extract(data,'$.type')='step-finish'`,
          )
          .get() as { n: number };
        assert.equal(r.detail!.steps, steps.n, "steps match raw SQL");
      } finally {
        raw.close();
      }
    }),
  );
  console.log("  ✓ readPassiveUsage detail cross-checks against raw SQL");
});
