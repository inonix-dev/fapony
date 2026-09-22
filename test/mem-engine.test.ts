import { test } from "bun:test";
// test/mem-engine.test.ts — shared add/close engine (PLAN-unify-mem-engine
// chunk 1): caps throw a typed CapError with the bare message (no MEM_FORCE
// hint — wrappers add their own wording), and MEM_FORCE bypasses the caps.

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAP_NEXT,
  CapError,
  engineAdd,
  engineClose,
} from "../src/mem/engine.js";
import { initStore } from "../src/mem/store.js";

test("testEngineCapThrowsBareCapError", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-engine-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    const rows = Array.from({ length: CAP_NEXT }, (_, i) =>
      JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        agent: "t",
        id: `n${i}`,
        kind: "next",
        text: `open ${i}`,
        files: ["a.ts"],
      }),
    );
    writeFileSync(join(memDir, "log.jsonl"), `${rows.join("\n")}\n`);
    initStore(dir);

    // cap full → typed error, bare message (CLI appends the hint itself)
    assert.throws(
      () => engineAdd({ kind: "next", text: "one more", files: ["b.ts"] }),
      (e: unknown) => {
        assert.ok(e instanceof CapError);
        assert.equal((e as CapError).cap, "next");
        assert.match(
          (e as Error).message,
          /open next 15\/15 is full — close an old one first/,
        );
        assert.doesNotMatch((e as Error).message, /MEM_FORCE/);
        return true;
      },
    );

    // MEM_FORCE bypasses — both wrappers rely on this
    process.env.MEM_FORCE = "1";
    try {
      const added = engineAdd({
        kind: "next",
        text: "forced",
        files: ["b.ts"],
      });
      assert.ok(added.id);
    } finally {
      delete process.env.MEM_FORCE;
    }

    // close-text rule: an empty tombstone errors (CLI accepted it before chunk 1)
    assert.throws(
      () => engineClose({ id: "n0", text: "  " }),
      /text is required/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ engine caps throw bare CapError; empty close text rejected");
});
