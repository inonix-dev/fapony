// src/init-mem.ts — scaffold the canonical .memory/ system into a new worktree.
// Source of truth lives in fapony/templates/mem/ — named after the CLI it implements
// (`mem`), not after where it lands; the destination keeps the .memory name because that
// is where the log lives.
// Destination is <worktree>/.fapony/.memory/ (plans/specs/memory all live under
// .fapony/; run state stays in ~/.config/fapony/state.db, never in the worktree).
// Re-run to re-sync after editing the template — not automatic, on purpose.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, memoryEntry } from "./db/index.js";

export function copyDir(src: string, dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyDir(s, d));
    } else {
      copyFileSync(s, d);
      copied.push(d);
    }
  }
  return copied;
}

export function cmdInitMem(args: string[]): void {
  const update = args.includes("--update");
  const worktreeKey = args.find((x) => !x.startsWith("-"));
  const config = loadConfig();

  // ไม่ระบุ key = repo ที่ยืนอยู่ตอนนี้ — ทำให้ `fapony init-mem --update` รันในโปรเจกต์ของใครก็ได้
  // โดยไม่ต้องลงทะเบียน worktree ก่อน (loadConfig อ่าน fapony.config.json ของ cwd อยู่แล้ว
  // จึงได้ paths.memoryEntry ของโปรเจกต์นั้นมาเอง)
  const worktree = worktreeKey ? config.worktrees[worktreeKey] : process.cwd();
  if (!worktree) {
    console.error(`unknown worktree key: ${worktreeKey}`);
    console.error(`available: ${Object.keys(config.worktrees).join(", ")}`);
    process.exit(1);
  }

  const templateDir = join(import.meta.dir, "..", "templates", "mem");
  const memEntry = memoryEntry(config);
  const destDir = join(worktree, dirname(memEntry));
  const destFile = join(worktree, memEntry);

  if (existsSync(destFile) && !update) {
    console.error(
      `${destFile} already exists — re-running would overwrite local edits.\nRun \`fapony init-mem --update\` to refresh it from the template (log.jsonl is kept).`,
    );
    process.exit(1);
  }
  if (update && !existsSync(destFile)) {
    console.error(`${destFile} not found — run \`fapony init\` first.`);
    process.exit(1);
  }

  const files = copyDir(templateDir, destDir);
  if (update) {
    console.log(`updated ${files.length} files in ${destDir}`);
    console.log(`(log.jsonl and other data files left untouched)`);
    return;
  }
  console.log(`scaffolded ${files.length} files into ${destDir}`);
  console.log(`\nAdd to fapony.config.json:`);
  console.log(
    `  "memory": {\n    "claim": ["bun", "${memEntry}", "claim", "{id}"],\n    "close": ["bun", "${memEntry}", "close", "{id}", "{msg}"],\n    "add":   ["bun", "${memEntry}", "add", "{kind}", "{text}"],\n    "kickoff": ["bun", "${memEntry}", "kickoff"]\n  }`,
  );
}
