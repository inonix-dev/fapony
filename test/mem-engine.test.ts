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
  CLI_FIND_EXCLUDE,
  engineAdd,
  engineClose,
  engineFind,
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

test("testEngineFindExcludeKindAndIncludeWins", () => {
  // PLAN-unify-mem-engine chunk 2 §4.2: the engine takes excludeKind, each
  // side passes its own default — MCP passes none (contract: every kind, no
  // default filter), CLI passes the bookkeeping list. An explicit kind
  // include wins over the exclude (so `find --kind close` can see closes).
  const rows = [
    { ts: "2026-01-01T00:00:00.000Z", kind: "decision", text: "a" },
    { ts: "2026-01-02T00:00:00.000Z", kind: "close", text: "b", ref: "x" },
    { ts: "2026-01-03T00:00:00.000Z", kind: "claim", ref: "y" },
    { ts: "2026-01-04T00:00:00.000Z", kind: "bug", text: "c" },
  ];
  const cli = engineFind(rows, { excludeKind: CLI_FIND_EXCLUDE });
  assert.equal(
    cli.total,
    2,
    "CLI default hides close/claim (synced/release too)",
  );
  assert.ok(cli.rows.every((r) => r.kind === "decision" || r.kind === "bug"));

  const mcp = engineFind(rows, {});
  assert.equal(mcp.total, 4, "MCP default: no filter");

  const explicit = engineFind(rows, {
    kind: ["close"],
    excludeKind: CLI_FIND_EXCLUDE,
  });
  assert.equal(explicit.total, 1, "explicit kind wins over the exclude");
  assert.equal(explicit.rows[0].kind, "close");
  console.log("  ✓ engineFind kind default per side; explicit kind wins");
});

test("testEngineFindTextFilesSinceLimit", () => {
  const rows = [
    {
      ts: "2026-01-01T00:00:00.000Z",
      kind: "decision",
      text: "wrapper lives in service",
      files: ["src/deep/zone/handler.ts"],
    },
    {
      ts: "2026-06-01T00:00:00.000Z",
      kind: "bug",
      text: "unrelated",
      spec: "apps/vela/SPEC-x.md",
    },
    { ts: "2026-06-02T00:00:00.000Z", kind: "note", text: "newest row" },
  ];
  // text matches spec too (CLI HELP promises text/spec/ref)
  assert.equal(engineFind(rows, { text: "spec-x" }).total, 1);
  // stored files[] first, suffix still matches
  assert.equal(engineFind(rows, { files: ["handler.ts"] }).total, 1);
  assert.equal(engineFind(rows, { files: ["src/other.ts"] }).total, 0);
  // since is inclusive
  assert.equal(
    engineFind(rows, { sinceIso: "2026-06-01T00:00:00.000Z" }).total,
    2,
  );
  // total counts before limit; order is newest first
  const lim = engineFind(rows, { limit: 2 });
  assert.equal(lim.total, 3);
  assert.equal(lim.rows.length, 2);
  assert.equal(lim.rows[0].ts, "2026-06-02T00:00:00.000Z");
  console.log("  ✓ engineFind text/files/since/limit");
});

test("testEngineFindOpenDropsClosedAndBookkeeping", () => {
  // PLAN-unify-mem-engine chunk 4: open:true = unresolved work only — the
  // answer to "what bugs remain" without correlating close tombstones by hand.
  const rows = [
    { ts: "2026-01-01T00:00:00.000Z", kind: "bug", text: "open bug", id: "b1" },
    {
      ts: "2026-01-02T00:00:00.000Z",
      kind: "bug",
      text: "fixed bug",
      id: "b2",
    },
    { ts: "2026-01-03T00:00:00.000Z", kind: "close", text: "fixed", ref: "b2" },
    { ts: "2026-01-04T00:00:00.000Z", kind: "note", text: "context", id: "n1" },
    { ts: "2026-01-05T00:00:00.000Z", kind: "synced", text: "s" },
    { ts: "2026-01-06T00:00:00.000Z", kind: "claim", text: "c", ref: "b1" },
  ];
  const all = engineFind(rows, {});
  assert.equal(all.total, 6, "default false: recall shows closed rows too");
  const open = engineFind(rows, { open: true });
  assert.equal(open.total, 2, "drops the closed bug + close/claim/synced");
  assert.ok(open.rows.every((r) => r.text !== "fixed bug"));
  const openBugs = engineFind(rows, { open: true, kind: ["bug"] });
  assert.equal(openBugs.total, 1);
  assert.equal(openBugs.rows[0].text, "open bug");
  console.log("  ✓ engineFind open:true drops closed + bookkeeping");
});
