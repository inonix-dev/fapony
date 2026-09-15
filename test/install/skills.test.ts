// test/install/skills.test.ts — linkSkills (skill symlinks shared by all clients)

import assert from "node:assert";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTALL_ROOT, linkSkills } from "../../src/install.js";
import { skillNames } from "./helpers.js";

export function testLinkSkillsCreatesSymlinks(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    const results = linkSkills(dir, false);
    const names = skillNames();
    assert.ok(names.length > 0, "repo should ship at least one skill");
    assert.deepStrictEqual(
      results.map((r) => r.name),
      names,
    );
    assert.ok(results.every((r) => r.action === "linked"));
    for (const name of names) {
      const dest = join(dir, name);
      assert.ok(
        lstatSync(dest).isSymbolicLink(),
        `${name} should be a symlink`,
      );
      assert.strictEqual(readlinkSync(dest), join(INSTALL_ROOT, "skill", name));
      // the link must resolve to the real SKILL.md, not just exist
      assert.ok(existsSync(join(dest, "SKILL.md")));
    }
    console.log("  ✓ linkSkills symlinks each skill dir");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testLinkSkillsIdempotent(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    linkSkills(dir, false);
    const second = linkSkills(dir, false);
    assert.ok(
      second.every((r) => r.action === "already"),
      "re-linking should report already, not conflict",
    );
    console.log("  ✓ linkSkills is idempotent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testLinkSkillsRefusesOverwrite(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    const victim = skillNames()[0];
    mkdirSync(join(dir, victim), { recursive: true });
    writeFileSync(join(dir, victim, "SKILL.md"), "# not fapony's\n");

    const results = linkSkills(dir, false);
    const hit = results.find((r) => r.name === victim);
    assert.strictEqual(hit?.action, "conflict");
    assert.strictEqual(
      readFileSync(join(dir, victim, "SKILL.md"), "utf-8"),
      "# not fapony's\n",
      "an existing skill must survive untouched",
    );
    assert.ok(
      results.some((r) => r.action === "linked"),
      "one conflict must not block the other skills",
    );
    console.log("  ✓ linkSkills never overwrites an existing skill");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testLinkSkillsDryRunNoWrite(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    const results = linkSkills(dir, true);
    assert.ok(results.every((r) => r.action === "linked"));
    for (const r of results) {
      assert.ok(
        !existsSync(join(dir, r.name)),
        `${r.name} must not be created`,
      );
    }
    console.log("  ✓ linkSkills --dry-run creates nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
