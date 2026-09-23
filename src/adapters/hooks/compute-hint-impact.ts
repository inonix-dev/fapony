// src/adapters/hooks/compute-hint-impact.ts — hint-fire impact computation
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). Reads hint log + re-runs
// debt detection to count resolved vs unresolved hints.

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  type HintFireRow,
  type HintImpact,
  hintLogDir,
  worktreeKey,
} from "../../core/hint-log.js";
import { debtForFile, resolveDebtScope } from "../../debt/index.js";

/**
 * Compute hint-fire impact from the log. `since` is an ISO date string;
 * omit to scan all rows. `worktree` scopes to one project's log file.
 */
export function computeHintImpact(
  since?: string,
  worktree?: string,
): HintImpact {
  const dir = hintLogDir();
  const impact: HintImpact = {
    fired: 0,
    by_surface: {
      read: 0,
      debt: 0,
      mem: 0,
      commit: 0,
      edit: 0,
      "open-bug": 0,
      "handoff-would-block": 0,
      "handoff-pass": 0,
    },
    debt: { shown: 0, resolved: 0, unknown: 0 },
    window: since ?? null,
  };

  if (!existsSync(dir)) return impact;

  let files: string[];
  try {
    const all = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    files = worktree
      ? all.filter((f) => f === `${worktreeKey(worktree)}.jsonl`)
      : all;
  } catch {
    return impact;
  }

  const debtShown = new Map<string, true>();
  const debtByFile = new Map<string, string[]>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line) continue;
      let row: HintFireRow;
      try {
        row = JSON.parse(line) as HintFireRow;
      } catch {
        continue;
      }
      if (since && row.ts < since) continue;
      impact.fired++;
      impact.by_surface[row.surface]++;

      if (row.surface === "debt" && row.ids && row.file) {
        const key = `${row.worktree}\t${row.file}`;
        const existing = debtByFile.get(key) ?? [];
        for (const id of row.ids) {
          const dk = `${row.worktree}\t${row.file}\t${id}`;
          if (!debtShown.has(dk)) {
            debtShown.set(dk, true);
            existing.push(id);
          }
        }
        debtByFile.set(key, existing);
      }
    }
  }

  for (const [key, ids] of debtByFile) {
    const [worktree, file] = key.split("\t");
    let absFile = join(worktree, file);
    let currentIds: Set<string>;
    try {
      if (!statSync(absFile).isFile()) {
        impact.debt.unknown += ids.length;
        continue;
      }
      // The log stores the worktree lexically; scanRoot is physical —
      // resolve so debtForFile compares like with like.
      try {
        absFile = realpathSync(absFile);
      } catch {
        // keep the lexical form
      }
      // Same scope as the hint itself — resolving at the git root would
      // load zero conventions in a monorepo and count every shown id as
      // resolved (precision stuck at 100%).
      const scope = resolveDebtScope(dirname(absFile));
      const convs = debtForFile(scope.scanRoot, absFile, scope.loaded);
      currentIds = new Set(convs.map((c) => c.id));
    } catch {
      impact.debt.unknown += ids.length;
      continue;
    }
    for (const id of ids) {
      impact.debt.shown++;
      if (currentIds.has(id)) {
        // still present — not resolved
      } else {
        impact.debt.resolved++;
      }
    }
  }

  return impact;
}
