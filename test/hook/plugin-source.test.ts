import { test } from "bun:test";
import assert from "node:assert";
import { editHintPluginSource } from "../../src/install/opencode.js";

test("testEditHintPluginSource", () => {
  const src = editHintPluginSource("/install/root");
  assert.ok(
    src.includes("/install/root/src/hook.ts"),
    "bakes the install root",
  );
  assert.ok(src.includes('input.tool !== "edit"'), "guards the edit tool");
  assert.ok(src.includes('input.tool !== "write"'), "guards the write tool");
  assert.ok(!src.includes("apply_patch"), "apply_patch stays out of scope");
  assert.ok(src.includes("output.output"), "mutates the tool output");
  assert.ok(!src.includes("throw"), "must never throw into the tool call");
  assert.ok(
    src.includes("editHintFor"),
    "must import editHintFor from the shared module",
  );
  assert.ok(
    src.includes('surface: "edit"'),
    "must log through the edit fire surface",
  );
  assert.ok(
    src.includes('surface: "debt"') && !src.includes("memLines"),
    "logs debt fires; mem context moved to fael",
  );
  assert.ok(
    src.includes("pjoin(directory, filePath)"),
    "fire-log joins against directory, not worktree",
  );
  const guard = src.indexOf('typeof output.output !== "string"');
  const call = src.indexOf("editHintFor({");
  assert.ok(
    guard >= 0 && call >= 0 && guard < call,
    "output guard must precede the editHintFor call",
  );
  console.log(
    "  ✓ edit hint opencode plugin imports shared logic, annotate-only",
  );
});
