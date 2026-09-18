// commands/rotate.ts — compact log.jsonl once it grows past a row-count threshold
// keep open work rows + active claims; the rest (close/release/synced of already-closed refs)
// is git mv'd to a separate archive file (not deleted) — old history remains, searchable via git log/git show

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rotateKeep } from "../selectors.js";
import { appendRaw, dir, LOG, rows } from "../store.js";

// ponytail: threshold = total row count, not just open — the fear is a bloated file / slow grep when many people use it at once
// (the view being unreadable is a separate problem the CAP in write.ts already handles)
// 3000 estimated from one solo week = ~2k rows — tune with MEM_ROTATE_THRESHOLD if the pace differs a lot from this
export const THRESHOLD = Number(process.env.MEM_ROTATE_THRESHOLD) || 3000;

export const cmdRotate = (a: string[]) => {
  const apply = a.includes("--apply");
  const all = rows();
  const over = all.length >= THRESHOLD;

  if (!apply) {
    console.log(
      `${all.length} rows (threshold ${THRESHOLD})${over ? " — over the threshold, run --apply" : " — under the threshold"}`,
    );
    return;
  }
  if (!over && !process.env.MEM_FORCE) {
    console.log(
      `${all.length}/${THRESHOLD} rows — under the threshold, no rotate needed (MEM_FORCE=1 to do it anyway)`,
    );
    return;
  }

  const keep = rotateKeep(all);
  const stamp = new Date().toISOString().slice(0, 10);
  const archived = join(dir, `log.${stamp}.jsonl`);
  if (existsSync(archived)) {
    console.error(
      `${archived} already exists (rotated today?) — remove or move it first to run again`,
    );
    process.exit(1);
  }

  // like plan-sweep: stage first to stop git mv failing silently if the file is untracked (exit 128)
  Bun.spawnSync(["git", "add", LOG]);
  const mv = Bun.spawnSync(["git", "mv", LOG, archived]);
  if (mv.exitCode !== 0) {
    console.error(
      `git mv failed (${mv.stderr.toString().trim()}) — rotate aborted`,
    );
    process.exit(1);
  }

  writeFileSync(LOG, "");
  for (const r of keep) appendRaw(LOG, r);

  console.log(
    `rotated: ${all.length} rows → archive ${archived.replace(`${dir}/`, "")} (git history intact), ${keep.length} row(s) left in log.jsonl (open + active claims)`,
  );
};
