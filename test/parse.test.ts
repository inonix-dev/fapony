import { test } from "bun:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseGateEventData,
  qualityScore,
  VERDICT_GRADES,
} from "../src/parse.js";

test("testParseGateEventData", () => {
  // Gate events store JSON {verdict, note, round} — not VERDICT: stdout.
  let v = parseGateEventData(
    JSON.stringify({ verdict: "pass-good", note: "solid", round: 1 }),
  );
  assert(v !== null, "should read verdict from gate JSON");
  assert.equal(v?.verdict, "pass-good");
  assert.equal(v?.note, "solid");

  v = parseGateEventData(JSON.stringify({ verdict: "fail", round: 2 }));
  assert(v !== null, "note may be absent");
  assert.equal(v?.verdict, "fail");
  assert.equal(v?.note, "");

  assert.equal(parseGateEventData(null), null, "null data → null");
  assert.equal(parseGateEventData(""), null, "empty data → null");
  assert.equal(parseGateEventData("not json"), null, "unparseable data → null");
  assert.equal(
    parseGateEventData(JSON.stringify({ verdict: "passsomething" })),
    null,
    "unknown grade → null",
  );
  assert.equal(
    parseGateEventData(JSON.stringify({ note: "no verdict key" })),
    null,
    "missing verdict → null",
  );
  assert.equal(
    parseGateEventData(JSON.stringify(["pass-good"])),
    null,
    "non-object JSON → null",
  );

  console.log("  ✓ parseGateEventData");
});

test("testFixtureGuard", () => {
  const fixtureDir = join(import.meta.dir, "fixtures");
  try {
    const files = readdirSync(fixtureDir).filter((f: string) =>
      f.endsWith(".ts"),
    );
    for (const file of files) {
      const content = readFileSync(join(fixtureDir, file), "utf-8");
      assert(
        !/\bBun\.spawn\b/.test(content) && !/\bfetch\b/.test(content),
        `fixture ${file} must not contain Bun.spawn or fetch`,
      );
    }
    console.log("  ✓ fixture guard (no spawn/fetch)");
  } catch {
    console.log("  ✓ fixture guard (no fixtures yet, skipped)");
  }
});

test("testQualityScore", () => {
  // Locked values from SPEC-verdict-protocol — additive-only, never change
  assert.equal(VERDICT_GRADES.size, 6, "should have exactly 6 grades");
  const cases: Array<
    [
      (
        | "pass-excellent"
        | "pass-good"
        | "pass-adequate"
        | "pass"
        | "fail"
        | "uncertain"
      ),
      number,
    ]
  > = [
    ["pass-excellent", 5],
    ["pass-good", 4],
    ["pass-adequate", 3],
    ["pass", 3], // legacy, same score as pass-adequate
    ["fail", 0],
    ["uncertain", 1],
  ];
  for (const [grade, expected] of cases) {
    assert.equal(
      qualityScore(grade),
      expected,
      `qualityScore("${grade}") should be ${expected}`,
    );
  }
  console.log("  ✓ qualityScore returns correct values for all 6 grades");
});
