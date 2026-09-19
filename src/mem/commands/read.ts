// commands/read.ts — read-only commands: now (default), done, stale, find, kickoff

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { doneLines, fmtClose, fmtRow, printOpenRows } from "../render.js";
import { claimsOf, openRows, staleReport } from "../selectors.js";
import type { CloseRow, WorkRow } from "../store.js";
import { allRows, app, memCmd, planDir, rows } from "../store.js";
import { planSweepCmd, shippedNotMoved } from "./plan.js";
import { THRESHOLD } from "./rotate.js";

const rotateLine = (n: number) =>
  n >= THRESHOLD
    ? `\n## 🗜 log ${n} rows (≥ ${THRESHOLD}) — run: ${memCmd} rotate --apply`
    : "";

const planSweepLine = () => {
  const pending = shippedNotMoved();
  return pending.length
    ? `\n## 📦 shipped but not archived into done/ (${pending.length})\n` +
        pending.map((n) => `- ${n}`).join("\n") +
        `\n(move: ${planSweepCmd} <file.md> --apply)`
    : "";
};

export const cmdNow = () => {
  // mem now (default) — next+bug+hold. decision/note is not pending work → search with find instead
  const all = rows();
  console.log(`# ${app} — ${all.length} entries`);
  printOpenRows(all, { showHold: true });
  const decisionN = openRows(all).filter((r) => r.kind === "decision").length;
  const noteN = openRows(all).filter((r) => r.kind === "note").length;
  console.log(
    `\n## decision ${decisionN} · note ${noteN} — search: ${memCmd} find <word>`,
  );
  const stale = staleReport(all);
  if (stale.length)
    console.log(
      `\n## ⚠ stale (${stale.length})\n` +
        stale.map((l) => `- ${l}`).join("\n"),
    );
  const sweep = planSweepLine();
  if (sweep) console.log(sweep);
  const rotate = rotateLine(all.length);
  if (rotate) console.log(rotate);
};

export const cmdDone = () => {
  const all = rows();
  for (const l of doneLines(all)) console.log(l);
};

export const cmdStale = () => {
  for (const l of staleReport(rows())) console.log(l);
};

export const cmdFind = (a: string[]) => {
  // mem find <word> — grep text/spec case-insensitively, newest first, capped at 20 rows
  const q = a.join(" ").toLowerCase();
  if (!q) {
    console.error(`usage: ${memCmd} find <word>`);
    process.exit(1);
  }
  // allRows, not rows: find is recall — rotated history counts
  const hits = allRows()
    .filter(
      (r): r is WorkRow =>
        r.kind !== "close" &&
        r.kind !== "synced" &&
        r.kind !== "claim" &&
        r.kind !== "release",
    )
    .filter(
      (r) =>
        r.text.toLowerCase().includes(q) ||
        (r.spec ?? "").toLowerCase().includes(q),
    )
    .slice(-20);
  for (const r of hits)
    console.log(
      `- [${r.id}] ${r.ts.slice(0, 10)} ${r.kind} ${r.text}${r.spec ? ` → ${r.spec}` : ""}`,
    );
  if (!hits.length) console.log("(no matches)");
};

/** Read a plan file and extract unchecked checkboxes from the TL;DR section. */
const readPlanCheckboxes = (planPath: string): string[] => {
  try {
    const text = readFileSync(planPath, "utf8");
    // Skip frontmatter
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    // Find the first ## section (TL;DR)
    const start = body.search(/^##\s+/m);
    if (start < 0) return [];
    const rest = body.slice(start);
    const next = rest.slice(3).search(/^##\s+/m);
    const block = next < 0 ? rest : rest.slice(0, next + 3);
    // Extract unchecked checkboxes
    const items: string[] = [];
    for (const line of block.split("\n")) {
      const m = /^\s*[-*]\s+\[\s\]\s+(.+)$/.exec(line);
      if (m) items.push(m[1].trim());
    }
    return items;
  } catch {
    return [];
  }
};

/** Check if a plan has `priority: high` in its frontmatter. */
const hasHighPriority = (planPath: string): boolean => {
  try {
    const head = readFileSync(planPath, "utf8").slice(0, 1024);
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    if (!m) return false;
    return /^\s*priority\s*:\s*high\s*$/m.test(m[1]);
  } catch {
    return false;
  }
};

/** Read the title from a plan file (first # heading). */
const readPlanTitle = (planPath: string): string => {
  try {
    const text = readFileSync(planPath, "utf8");
    const m = /^#\s+(.+)$/m.exec(text);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
};

const normSpec = (s: string) => s.replace(/\\/g, "/").replace(/^\.\//, "");

// kickoff's spec arg used to be compared to r.spec as a literal string, so
// `.fapony/plan/PLAN-x.md` had to be retyped byte-for-byte — and a typo printed
// "(no entries)" with nothing to notice. Resolve against the spec paths the log
// actually holds: exact path first, then by filename (with or without .md), then by
// any path suffix. Returns all candidates so the caller can tell unique from ambiguous.
const resolveSpec = (target: string, specs: string[]): string[] => {
  const t = normSpec(target);
  const all = [...new Set(specs)];
  const exact = all.filter((s) => normSpec(s) === t);
  if (exact.length) return exact;
  const base = basename(t);
  const withMd = base.endsWith(".md") ? base : `${base}.md`;
  const byName = all.filter((s) => {
    const b = basename(normSpec(s));
    return b === base || b === withMd;
  });
  if (byName.length) return byName;
  return all.filter((s) => normSpec(s).endsWith(`/${t}`));
};

export const cmdKickoff = (a: string[]) => {
  // mem kickoff [id|spec.md] [--pick <n>]
  // the spec may be the full path or just its filename
  const all = rows();

  // Parse --pick flag first
  let pickIdx: number | null = null;
  const pickFlagIdx = a.indexOf("--pick");
  if (pickFlagIdx !== -1) {
    const val = a[pickFlagIdx + 1];
    pickIdx = parseInt(val ?? "", 10);
    if (Number.isNaN(pickIdx) || pickIdx < 1) {
      console.error("--pick requires a positive number");
      process.exit(1);
    }
  }
  // Filter out --pick and its value to get the main arguments
  const mainArgs =
    pickFlagIdx !== -1
      ? a.filter((_, i) => i !== pickFlagIdx && i !== pickFlagIdx + 1)
      : a;
  const arg = mainArgs[0] ?? "";

  // --- resolve spec/id for the main output ---
  const workAll = all.filter((r): r is WorkRow => "id" in r);
  const byId = new Map(workAll.map((r) => [r.id, r] as const));
  const specNames = [
    ...new Set(
      all.flatMap((r) => ("spec" in r && r.spec ? [r.spec as string] : [])),
    ),
  ].sort();
  const target = byId.get(arg);
  const matches = resolveSpec(arg, specNames);
  let resolvedSpec = matches.find((s) => normSpec(s) === normSpec(arg));

  // If no arg or arg didn't match an id/spec, check if it's a plan file
  let planFile: string | null = null;
  let planCheckboxes: string[] = [];

  if (arg && !resolvedSpec && !target) {
    if (matches.length === 1) {
      resolvedSpec = matches[0];
    } else if (matches.length > 1) {
      console.error(
        `"${arg}" could mean ${matches.length} specs — retype one in full:`,
      );
      for (const m of matches) console.error(`  ${m}`);
      process.exit(1);
    } else if (arg.endsWith(".md")) {
      // Try to find it as a plan file
      const dir = planDir;
      const candidates = [join(dir, basename(arg)), join(dir, arg), arg];
      for (const c of candidates) {
        if (existsSync(c)) {
          planFile = c;
          break;
        }
      }
      if (!planFile) {
        console.error(`no entries for spec "${arg}"`);
        if (specNames.length) {
          console.error(`specs in the log:`);
          for (const s of specNames) console.error(`  ${s}`);
        }
        process.exit(1);
      }
    }
  }

  // Read plan file if we found one (or if a .md arg matched a spec)
  if (planFile) {
    planCheckboxes = readPlanCheckboxes(planFile);
  } else if (arg && resolvedSpec && arg.endsWith(".md")) {
    // The spec resolved from the log might be a plan file — try to read it
    const dir = planDir;
    const byName = join(dir, basename(arg));
    if (existsSync(byName)) {
      planFile = byName;
      planCheckboxes = readPlanCheckboxes(planFile);
    }
  }

  // --- main output (unchanged behavior) ---

  if (!arg && !planFile) {
    // no args = now + a "recent" section = the last 10 closes
    console.log(`# ${app} — ${all.length} entries`);
    printOpenRows(all, { showHold: true });
    console.log(`\n## recent\n${doneLines(all, 10).join("\n")}`);
    const stale = staleReport(all);
    if (stale.length)
      console.log(
        `\n## ⚠ stale (${stale.length})\n` +
          stale.map((l) => `- ${l}`).join("\n"),
      );
    const sweep = planSweepLine();
    if (sweep) console.log(sweep);
    const rotate = rotateLine(all.length);
    if (rotate) console.log(rotate);
  } else if (resolvedSpec) {
    // spec.md = a brief for that spec
    const open = openRows(all);
    const specRows = open.filter((r) => r.spec === resolvedSpec);
    const specDecisions = all
      .filter(
        (r): r is WorkRow => r.kind === "decision" && r.spec === resolvedSpec,
      )
      .slice(-5);
    const specCloses = all
      .filter((r): r is CloseRow => r.kind === "close")
      .filter((r) => byId.get(r.ref)?.spec === resolvedSpec)
      .slice(-3);

    console.log(`# ${resolvedSpec} — ${specRows.length} open rows`);
    if (specRows.length) {
      console.log(`\n## open\n${specRows.map((r) => fmtRow(r)).join("\n")}`);
    }
    if (specDecisions.length) {
      console.log(
        `\n## decisions\n` +
          specDecisions
            .map((r) => `- ${r.ts.slice(0, 10)} ${r.text}`)
            .join("\n"),
      );
    }
    if (specCloses.length) {
      console.log(
        `\n## closes\n${specCloses.map((c) => fmtClose(c, byId)).join("\n")}`,
      );
    }
    if (!specRows.length && !specDecisions.length && !specCloses.length) {
      console.log("(no entries for this spec)");
    }
  } else if (target) {
    // id = a brief for that task
    const claims = claimsOf(all);
    const claimInfo = claims.has(arg)
      ? `\nClaimed by: ${claims.get(arg)?.agent} (${claims.get(arg)?.ts.slice(0, 10)})`
      : "";

    const spec = target.spec;
    const open = spec
      ? openRows(all).filter((r) => r.spec === spec && r.id !== arg)
      : [];
    const specDecisions = spec
      ? all
          .filter((r): r is WorkRow => r.kind === "decision" && r.spec === spec)
          .slice(-5)
      : [];
    const specNotes = spec
      ? all
          .filter((r): r is WorkRow => r.kind === "note" && r.spec === spec)
          .slice(-5)
      : [];
    const specCloses = spec
      ? all
          .filter((r): r is CloseRow => r.kind === "close")
          .filter((r) => byId.get(r.ref)?.spec === spec)
          .slice(-3)
      : [];

    console.log(
      `# [${target.id}] ${target.kind} — ${target.text}${target.spec ? ` → ${target.spec}` : ""}${claimInfo}`,
    );
    if (open.length) {
      console.log(
        `\n## open (same spec)\n` +
          open.map((r) => fmtRow(r, claims)).join("\n"),
      );
    }
    if (specDecisions.length || specNotes.length) {
      console.log(`\n## decisions & notes (spec)\n`);
      for (const r of [...specDecisions, ...specNotes]) {
        console.log(`- ${r.ts.slice(0, 10)} ${r.kind} ${r.text}`);
      }
    }
    if (specCloses.length) {
      console.log(
        `\n## closes (spec)\n` +
          specCloses.map((c) => fmtClose(c, byId)).join("\n"),
      );
    }
  } else if (arg) {
    console.error(`no id "${arg}" in the log`);
    process.exit(1);
  }

  // --- next up section (chunk 3) ---

  type Suggestion = { text: string; run: string };
  const suggestions: Suggestion[] = [];

  // Priority plans from the plan directory
  if (existsSync(planDir)) {
    const files = readdirSync(planDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const fullPath = join(planDir, file);
      // Skip the plan we already showed
      if (planFile && fullPath === planFile) continue;
      if (hasHighPriority(fullPath)) {
        const title = readPlanTitle(fullPath);
        suggestions.push({
          text: `${title || file} (${file})`,
          run: `fapony mem kickoff ${file}`,
        });
      }
    }
  }

  // Plan file unchecked checkboxes (from the plan passed as argument)
  for (const text of planCheckboxes) {
    const planName = planFile ? basename(planFile) : "plan";
    suggestions.push({
      text,
      run: `fapony mem kickoff ${planName}`,
    });
  }

  // Open bugs (oldest first)
  const openBugs = all
    .filter(
      (r): r is WorkRow =>
        "id" in r && r.kind === "bug" && !claimsOf(all).has(r.id),
    )
    .slice(0, 3);
  for (const b of openBugs) {
    suggestions.push({
      text: `#${b.id} ${b.text}`,
      run: `fapony mem close ${b.id} "<msg>"`,
    });
  }

  // Recently touched files from the last 3 rows with files[]
  const recentFiles = all
    .filter(
      (r): r is WorkRow =>
        "id" in r && "files" in r && !!(r as WorkRow).files?.length,
    )
    .slice(-3)
    .flatMap((r) => r.files ?? []);
  const uniqueRecent = [...new Set(recentFiles)].slice(0, 3);
  if (uniqueRecent.length) {
    suggestions.push({
      text: uniqueRecent.join(", "),
      run: `fapony review-seed --files ${uniqueRecent.join(",")}`,
    });
  }

  // Print and optionally execute
  if (suggestions.length) {
    console.log(`\n## next up`);
    for (let i = 0; i < suggestions.length; i++) {
      console.log(`  [${i + 1}] ${suggestions[i].text}`);
      console.log(`      → ${suggestions[i].run}`);
    }

    if (pickIdx !== null) {
      if (pickIdx > suggestions.length) {
        console.error(
          `--pick ${pickIdx}: only ${suggestions.length} suggestion(s) available`,
        );
        process.exit(1);
      }
      const cmd = suggestions[pickIdx - 1].run;
      console.log(`\n> running: ${cmd}`);
      const { execSync } = require("node:child_process");
      try {
        execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
      } catch {
        process.exit(1);
      }
    }
  }
};
