// test/telemetry/derived-tools.test.ts — telemetry derived tool counts + content guard

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { newRun } from "../../src/db/store.js";
import { buildPayload } from "../../src/telemetry.js";
import {
  createEmptyOpencodeDb,
  makeRun,
  withEmptyOpencodeDb,
  withTempConfig,
  withTmpDb,
} from "./helpers.js";

export function testTelemetryDerivedToolCountsScopedToWorktrees(): void {
  const { dir, dbPath } = createEmptyOpencodeDb();
  const ocDb = new Database(dbPath);
  ocDb.run(`INSERT INTO project (id, worktree) VALUES ('p1', '/wt/proj')`);
  ocDb.run(`INSERT INTO project (id, worktree) VALUES ('p2', '/elsewhere')`);
  ocDb.run(
    `INSERT INTO session (id, project_id, directory, model, time_created, tokens_input, tokens_output, cost) VALUES ('s1', 'p1', '/wt/proj', 'm', 1000, 10, 5, 0.01), ('s2', 'p2', '/elsewhere', 'm', 2000, 10, 5, 0.01)`,
  );
  const part = ocDb.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, 1, 1, ?)`,
  );
  // In-scope tool part carries input/output blobs — must never reach telemetry.
  part.run(
    "q1",
    "m1",
    "s1",
    JSON.stringify({
      type: "tool",
      tool: "read",
      state: {
        input: { filePath: "SECRET-INPUT-XYZ" },
        output: "SECRET-OUTPUT-XYZ",
      },
    }),
  );
  part.run("q2", "m1", "s1", JSON.stringify({ type: "tool", tool: "read" }));
  for (let i = 0; i < 5; i++) {
    part.run(
      `qx${i}`,
      "m1",
      "s2",
      JSON.stringify({ type: "tool", tool: "bash" }),
    );
  }
  ocDb.close();

  const prevDb = process.env.FAPONY_OPENCODE_DB;
  process.env.FAPONY_OPENCODE_DB = dbPath;
  try {
    withTempConfig({ worktrees: { proj: "/wt/proj" } }, () => {
      withTmpDb((db) => {
        // Run key "proj" resolves via config.worktrees; no gate needed —
        // tool counts alone trigger the derived section.
        newRun(db, "proj", null, null, "abc");

        const payload = buildPayload();
        const d = payload.machine.derived;
        assert.ok(d, "derived present");
        // Only the in-scope project counts; out-of-scope bash excluded.
        assert.deepEqual(d.tool_call_counts, { read: 2 });
        const blob = JSON.stringify(payload);
        assert(!blob.includes("bash"), "out-of-scope tools excluded");
        assert(
          !blob.includes("SECRET-INPUT-XYZ") &&
            !blob.includes("SECRET-OUTPUT-XYZ"),
          "tool input/output never reaches telemetry",
        );
      });
    });
  } finally {
    if (prevDb === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prevDb;
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ telemetry tool counts scoped to fapony worktrees, no I/O");
}

export function testTelemetryDerivedExcludedFromContentCheck(): void {
  withEmptyOpencodeDb(() => {
    withTmpDb((db) => {
      makeRun(
        db,
        "/Users/test/project",
        "m1",
        "pass-good",
        "2026-09-09 10:00:00",
        "2026-09-09 10:10:00",
      );
      const payload = buildPayload();
      const blob = JSON.stringify(payload);
      // derived must not contain any content fields
      assert(!blob.includes('"plan"'), "no plan in derived");
      assert(!blob.includes('"note"'), "no note in derived");
      assert(!blob.includes('"commit"'), "no commit in derived");
      assert(!blob.includes('"mem_id"'), "no mem_id in derived");
    });
  });

  console.log("  ✓ telemetry derived contains no content fields");
}
