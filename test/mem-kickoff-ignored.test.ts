import { test } from "bun:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempRepo } from "./helpers.js";

// kickoff says so when the mem log is gitignored — the log's promise is that
// a clone carries every decision, and an ignored log silently breaks it.

function kickoff(dir: string): string {
  const p = Bun.spawnSync(
    ["bun", "run", join(import.meta.dir, "..", "fapony.ts"), "mem", "kickoff"],
    {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, FAPONY_STATE_DIR: join(dir, ".state") },
    },
  );
  return p.stdout.toString();
}

test("testKickoffWarnsWhenMemLogIgnored", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony/.memory/log.Test.jsonl"),
      `${JSON.stringify({ ts: "2026-09-01T00:00:00Z", agent: "t", kind: "note", id: "n1", text: "hi", files: ["a.ts"] })}\n`,
    );
    assert.ok(!kickoff(dir).includes("gitignored"), "tracked log: silent");
    writeFileSync(join(dir, ".gitignore"), ".fapony/\n");
    assert.match(kickoff(dir), /⚠ mem log is gitignored/);
  });
});
