// commands/read.ts — read-only commands: now (default), done, stale, find, kickoff

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { collectSourceFiles } from "../../analyze/index.js";
import { parseSince } from "../../core/since.js";
import { baselinePath, readEvidenceLintCmd } from "../../lint-baseline.js";
import {
  checkTickedLine,
  planSweepCmd,
  shippedNotMoved,
} from "../../plan/sweep.js";
import { CLI_FIND_EXCLUDE, engineFind } from "../engine.js";
import { loadKeyRegistry } from "../key-registry.js";
import { doneLines, fmtClose, fmtRow } from "../render.js";
import {
  claimsOf,
  evictionReport,
  openKeys,
  openRows,
  staleReport,
} from "../selectors.js";
import type { CloseRow, LogRow, WorkRow } from "../store.js";
import { allRows, app, LOG, memCmd, planDir, root, rows } from "../store.js";
import { THRESHOLD } from "./rotate.js";

/**
 * One ⚠ line when the mem log is gitignored — the log's promise is that a
 * clone carries every decision; an ignored log keeps them on this machine
 * only, and nothing else says so. Ignoring may be deliberate (a public repo),
 * so this warns, never blocks.
 */
function ignoredLogLine(): string | null {
  try {
    const p = Bun.spawnSync(["git", "check-ignore", "-q", LOG], { cwd: root });
    if (p.exitCode !== 0) return null;
  } catch {
    return null;
  }
  return `⚠ mem log is gitignored (${basename(LOG)}) — decisions and plan ticks stay on this machine; a clone gets none of them`;
}

/** Files changed on this branch vs dev — empty set when dev is missing or diff fails. */
function getBranchDiffFiles(cwd: string): Set<string> {
  try {
    const p = Bun.spawnSync(["git", "diff", "--name-only", "dev...HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) return new Set();
    return new Set(p.stdout.toString().trim().split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

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

// Row-list caps: no row-list section exceeds 10 (same budget as ## recent,
// which takes doneLines(all, 10)). Per-row text is cut at a word boundary —
// a kickoff line points at the row (mem find has the full text), it must not
// reprint it.
const BUGS_LIMIT = 10;
const BRANCH_LIMIT = 10;
const RECENT_OPEN_LIMIT = 10;
const RECENT_OPEN_TEXT = 160;
const OPEN_KEYS_LIMIT = 8;

// Important-index line (PLAN-mem-keys chunk 3): one line under the kickoff
// header listing keys that still have open rows — silent when none. Placed
// before every tier so the 4KB session-start cap can never drop it (only
// ## recent is cut first). Counts are open rows per key, not total rows.
const openKeysLine = (all: LogRow[]): string => {
  const keys = openKeys(all);
  if (!keys.length) return "";
  const shown = keys.slice(0, OPEN_KEYS_LIMIT);
  const body = shown.map(({ key, open }) => `${key}(${open})`).join(", ");
  const more =
    keys.length > OPEN_KEYS_LIMIT ? ` +${keys.length - OPEN_KEYS_LIMIT}` : "";
  return `open keys: ${body}${more} — ${memCmd} find --key <key>`;
};

// Registry line (PLAN-mem-core chunk 4): one line naming the allowed domains
// so the agent keys the row right the first time — silent with no registry.
const keyDomainsLine = (): string => {
  const reg = loadKeyRegistry(root || process.cwd());
  if (!reg.path || !reg.domains.length) return "";
  return `key domains: ${reg.domains.join(", ")} — use --key domain:sub`;
};

const shortText = (text: string, max = RECENT_OPEN_TEXT): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut}…`;
};

export const cmdDone = () => {
  const all = rows();
  for (const l of doneLines(all)) console.log(l);
};

export const cmdStale = () => {
  const all = rows();
  for (const l of staleReport(all)) console.log(l);
  // Eviction (PLAN-mem-core chunk 5): rows whose files[] are all gone from
  // disk, with unique-basename moves followed. Local only — existsSync +
  // collectSourceFiles, never git. The tree walk runs only when some row
  // actually names a missing file.
  if (!root) return;
  const exists = (f: string) => existsSync(join(root, f));
  if (
    !all.some(
      (r) =>
        "files" in r && ((r as WorkRow).files ?? []).some((f) => !exists(f)),
    )
  )
    return;
  for (const l of evictionReport(all, exists, collectSourceFiles(root)))
    console.log(l);
};

export const cmdFind = (a: string[]) => {
  // mem find ["<text>"] [--kind a,b] [--files f1,f2] [--since <N>d|YYYY-MM-DD] [--limit n] [--key k] [--open]
  // Query logic lives in the shared engine (../engine.ts) — this wrapper owns
  // only argv parsing + the single-line print. MCP memFind calls the same
  // engine with no kind default (contract); CLI keeps its legacy default of
  // hiding bookkeeping rows unless --kind names them (PLAN-unify-mem-engine).
  const flagVal = (flag: string, i: number): string | undefined => {
    const t = a[i];
    const eq = `${flag}=`;
    if (t.startsWith(eq)) return t.slice(eq.length);
    return a[i + 1];
  };
  const consumed = (flag: string, i: number): number => {
    if (a[i].startsWith(`${flag}=`)) return 1;
    return 2;
  };

  // Accumulators, not reassignments: a repeated list flag must grow the set,
  // never last-win (PLAN-comma-x chunk 2). Exported as string[] | undefined
  // after the loop so every downstream check reads the same shape.
  const kindAcc: string[] = [];
  const filesAcc: string[] = [];
  let sinceRaw: string | undefined;
  let limit: number | undefined;
  let open = false;
  let key: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < a.length; ) {
    const t = a[i];
    if (t === "--kind" || t.startsWith("--kind=")) {
      const v = flagVal("--kind", i);
      if (!v || v.startsWith("--")) {
        console.error(
          `--kind needs a value — usage: ${memCmd} find "<text>" --kind bug,decision`,
        );
        process.exit(1);
      }
      kindAcc.push(
        ...v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      i += consumed("--kind", i);
    } else if (t === "--files" || t.startsWith("--files=")) {
      const v = flagVal("--files", i);
      if (!v || v.startsWith("--")) {
        console.error(
          `--files needs a value — usage: ${memCmd} find --files path/to/file.ts[,more]`,
        );
        process.exit(1);
      }
      filesAcc.push(
        ...v
          .split(",")
          .map((s) => s.trim().replace(/^\.\//, ""))
          .filter(Boolean),
      );
      i += consumed("--files", i);
    } else if (t === "--key" || t.startsWith("--key=")) {
      const v = flagVal("--key", i);
      if (!v || v.startsWith("--")) {
        console.error(
          `--key needs a value — usage: ${memCmd} find --key fix-stop-dedupe`,
        );
        process.exit(1);
      }
      // No KEY_RE validation on the read side — a wrong-pattern key never
      // exists in the log, so the engine answers with knownKeys instead.
      key = v;
      i += consumed("--key", i);
    } else if (t === "--since" || t.startsWith("--since=")) {
      const v = flagVal("--since", i);
      if (!v || v.startsWith("--")) {
        console.error(`--since needs a value — use <N>d or YYYY-MM-DD`);
        process.exit(1);
      }
      sinceRaw = v;
      i += consumed("--since", i);
    } else if (t === "--limit" || t.startsWith("--limit=")) {
      const v = flagVal("--limit", i);
      const n = Number(v);
      if (!v || v.startsWith("--") || !Number.isInteger(n) || n < 0) {
        console.error(
          `--limit needs a non-negative integer — got "${v ?? ""}"`,
        );
        process.exit(1);
      }
      limit = n;
      i += consumed("--limit", i);
    } else if (t === "--open") {
      open = true;
      i += 1;
    } else {
      positional.push(t);
      i += 1;
    }
  }

  const kind = kindAcc.length ? kindAcc : undefined;
  const files = filesAcc.length ? filesAcc : undefined;
  const q = positional.join(" ").trim();
  if (
    !q &&
    !kind?.length &&
    !files?.length &&
    !key &&
    !sinceRaw &&
    limit === undefined &&
    !open
  ) {
    console.error(
      `usage: ${memCmd} find ["<text>"] [--kind a,b] [--files f1,f2] [--since <N>d|YYYY-MM-DD] [--limit n] [--key k] [--open]`,
    );
    process.exit(1);
  }

  let sinceIso: string | undefined;
  if (sinceRaw) {
    try {
      sinceIso = parseSince(sinceRaw).iso;
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  // allRows, not rows: find is recall — rotated history counts
  const result = engineFind(allRows(), {
    text: q || undefined,
    files,
    kind,
    excludeKind: kind?.length ? undefined : CLI_FIND_EXCLUDE,
    sinceIso,
    key,
    limit,
    open: open || undefined,
  });
  // Legacy order: oldest first (engine returns newest first — same set, CLI print order unchanged)
  const hits = [...result.rows].reverse();
  for (const r of hits) {
    if ("id" in r) {
      // #key only when present — rows without one keep the old shape
      const keyTag = r.key ? ` #${r.key}` : "";
      console.log(
        `- [${r.id}] ${r.ts.slice(0, 10)} ${r.kind}${keyTag} ${r.text ?? ""}${r.spec ? ` → ${r.spec}` : ""}`,
      );
    } else {
      const label = "ref" in r && r.ref ? `${r.ref}(${r.kind})` : r.kind;
      const body = ("text" in r && r.text) || ("spec" in r && r.spec) || "";
      console.log(`- [${label}] ${r.ts.slice(0, 10)} ${r.kind} ${body}`);
    }
  }
  if (!hits.length) {
    // A wrong key answers with the real ones (SPEC fail example) — a silent
    // empty would read as "this problem never happened" (rule 9).
    if (key && result.knownKeys) {
      console.log(
        `no key ${key}; known keys: ${
          result.knownKeys.length ? result.knownKeys.join(", ") : "(none)"
        }`,
      );
    } else {
      console.log("(no matches)");
    }
  }
};

/** Read a plan file and extract checked + unchecked items from the first ## section. */
const readPlanSectionItems = (
  planPath: string,
): { checked: string[]; unchecked: string[] } => {
  try {
    const text = readFileSync(planPath, "utf8");
    // Skip frontmatter
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    // Find the first ## section (TL;DR)
    const start = body.search(/^##\s+/m);
    if (start < 0) return { checked: [], unchecked: [] };
    const rest = body.slice(start);
    const next = rest.slice(3).search(/^##\s+/m);
    const block = next < 0 ? rest : rest.slice(0, next + 3);
    // Extract checkboxes — ticked and unticked
    const checked: string[] = [];
    const unchecked: string[] = [];
    for (const line of block.split("\n")) {
      let m = /^\s*[-*]\s+\[\s\]\s+(.+)$/.exec(line);
      if (m) {
        unchecked.push(m[1].trim());
        continue;
      }
      m = /^\s*[-*]\s+\[[xX]\]\s+(.+)$/.exec(line);
      if (m) checked.push(m[1].trim());
    }
    return { checked, unchecked };
  } catch {
    return { checked: [], unchecked: [] };
  }
};

// Chunk 9 (PLAN-seed-and-surface): one line under the next-chunk display
// saying whether the last ticked chunk actually closed. Verified shas stay
// silent; only the newest ticked chunk is ever mentioned — one line per
// kickoff, never a list (else vela's 64/72 sha-less chunks become noise).
const closureHint = (checked: string[]): string | null => {
  const last = checked[checked.length - 1];
  if (!last) return null;
  const { missing, diverged, cited } = checkTickedLine(last, root);
  const label = /chunk\s+([^\s—–-]+)/i.exec(last)?.[1] ?? "latest";
  if (missing.length)
    return `⚠ chunk ${label} is ticked but ${missing[0]} is not in git — nothing proves it closed`;
  if (diverged.length)
    return `⚠ chunk ${label} is ticked but ${diverged[0]} is not on HEAD (rebased away?)`;
  if (!cited)
    return `⚠ chunk ${label} is ticked but cites no commit — nothing to verify it closed`;
  return null;
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
  let planChecked: string[] = [];

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
    const items = readPlanSectionItems(planFile);
    planCheckboxes = items.unchecked;
    planChecked = items.checked;
  } else if (arg && resolvedSpec && arg.endsWith(".md")) {
    // The spec resolved from the log might be a plan file — try to read it
    const dir = planDir;
    const byName = join(dir, basename(arg));
    if (existsSync(byName)) {
      planFile = byName;
      const items = readPlanSectionItems(planFile);
      planCheckboxes = items.unchecked;
      planChecked = items.checked;
    }
  }

  // --- suggestions (generated early so the no-args path can print next up
  //     before the recency tier, keeping it inside the 4KB cap) ---

  type Suggestion = { text: string; run?: string; manual?: boolean };
  const suggestions: Suggestion[] = [];
  const GROUP_CAP = 3;

  const truncate = (s: string, n = 80) =>
    s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

  // group 1 — plans: priority: high first, then the first unchecked chunk
  const planLines: Suggestion[] = [];
  if (existsSync(planDir)) {
    const files = readdirSync(planDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      if (planLines.length >= GROUP_CAP) break;
      const fullPath = join(planDir, file);
      if (planFile && fullPath === planFile) continue;
      if (hasHighPriority(fullPath)) {
        const title = readPlanTitle(fullPath);
        planLines.push({
          text: `${title || file} (${file})`,
          run: `fapony mem kickoff ${file}`,
        });
      }
    }
  }
  if (planLines.length < GROUP_CAP && planCheckboxes.length) {
    const planName = planFile ? basename(planFile) : "plan";
    planLines.push({ text: `${planCheckboxes[0]} (${planName})` });
  }
  suggestions.push(...planLines);

  // group 2 — open bugs, oldest first
  const suggClaims = claimsOf(all);
  const openBugs = openRows(all)
    .filter((r) => r.kind === "bug" && !suggClaims.has(r.id))
    .slice(0, GROUP_CAP);
  for (const b of openBugs) {
    suggestions.push({
      text: `bug #${b.id} — ${truncate(b.text)}`,
      run: `fapony mem close ${b.id} "<msg>"`,
      manual: true,
    });
  }

  // group 3 — the files of the last 3 rows that carried files[]
  const recentFiles = all
    .filter(
      (r): r is WorkRow =>
        "id" in r && "files" in r && !!(r as WorkRow).files?.length,
    )
    .slice(-3)
    .flatMap((r) => r.files ?? []);
  const uniqueRecent = [...new Set(recentFiles)].slice(0, GROUP_CAP);
  if (uniqueRecent.length) {
    suggestions.push({
      text: `Recently touched: ${uniqueRecent.join(", ")}`,
      run: `fapony review-seed --files ${uniqueRecent.join(",")}`,
    });
  }

  // group 4 — the lint baseline
  try {
    if (readEvidenceLintCmd(root) && !existsSync(baselinePath(root))) {
      suggestions.push({
        text: "lint baseline not captured yet — pre-existing red will count as yours",
        run: "fapony lint-baseline --capture",
      });
    }
  } catch {
    // state dir unreadable — the baseline line is a convenience, never a gate
  }

  /** Print ## next up and handle --pick. */
  const printNextUp = () => {
    if (!suggestions.length) return;
    console.log(`\n## next up`);
    for (let i = 0; i < suggestions.length; i++) {
      console.log(`  [${i + 1}] ${suggestions[i].text}`);
      if (suggestions[i].run) console.log(`      → ${suggestions[i].run}`);
    }
    if (pickIdx !== null) {
      if (pickIdx > suggestions.length) {
        console.error(
          `--pick ${pickIdx}: only ${suggestions.length} suggestion(s) available`,
        );
        process.exit(1);
      }
      const picked = suggestions[pickIdx - 1];
      if (!picked.run) {
        console.error(
          `--pick ${pickIdx}: "${picked.text}" is context, not a command — nothing to run`,
        );
        process.exit(1);
      }
      if (picked.manual) {
        console.error(
          `--pick ${pickIdx}: the command needs your own message — run it yourself:\n  ${picked.run}`,
        );
        process.exit(1);
      }
      const cmd = picked.run;
      console.log(`\n> running: ${cmd}`);
      const { execSync } = require("node:child_process");
      try {
        execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
      } catch {
        process.exit(1);
      }
    }
  };

  // --- main output ---

  // Deferred output for the no-args path — recent closes, plan sweep, rotate
  let kickoffExtras: (() => void) | null = null;

  if (!arg && !planFile) {
    // no args = ranked open rows + next up + recent closes
    console.log(`# ${app} — ${all.length} entries`);
    const ignored = ignoredLogLine();
    if (ignored) console.log(ignored);
    const keys = openKeysLine(all);
    if (keys) console.log(keys);
    const domains = keyDomainsLine();
    if (domains) console.log(domains);

    const open = openRows(all);
    const claims = claimsOf(all);
    const diffFiles = getBranchDiffFiles(root);

    // Tier 1: unclaimed bugs (always first, no matter how old) — capped: a
    // backlog of unclosable bugs must not push the rest of the ranking out.
    const bugs = open.filter((r) => r.kind === "bug" && !claims.has(r.id));
    if (bugs.length) {
      console.log(`\n## bugs`);
      for (const r of bugs.slice(0, BUGS_LIMIT)) console.log(fmtRow(r));
      if (bugs.length > BUGS_LIMIT)
        console.log(
          `… +${bugs.length - BUGS_LIMIT} more unclosed bugs — \`fapony mem find <word>\` for the rest`,
        );
    }

    // next up BEFORE the branch/recency tiers so no row-list section can
    // push it out — order is by actionability, never by "this tier is short".
    printNextUp();

    // Tier 2: rows whose files[] overlap with git diff --name-only dev...HEAD
    // — capped like every other row-list section (≤10 + overflow, pointer
    // lines via shortText): the branch diff is unbounded and mem clusters on
    // files every real branch touches, so uncapped this reprints the log.
    const bugIds = new Set(bugs.map((r) => r.id));
    const diffMatched = open.filter((r) => {
      if (bugIds.has(r.id)) return false;
      if (diffFiles.size === 0) return false;
      return (r.files ?? []).some((f) => diffFiles.has(f));
    });
    if (diffMatched.length) {
      console.log(`\n## on this branch`);
      for (const r of diffMatched.slice(0, BRANCH_LIMIT))
        console.log(fmtRow({ ...r, text: shortText(r.text) }, claims));
      if (diffMatched.length > BRANCH_LIMIT)
        console.log(
          `… +${diffMatched.length - BRANCH_LIMIT} more — \`fapony mem find <word>\` for the rest`,
        );
    }

    // Tier 3: rest by recency (newest first) — tie-breaker only, capped like
    // ## recent (doneLines takes 10): decision/note can never close, so an
    // uncapped tier reprints the whole log. Lines are pointers, not prose —
    // cut at a word boundary and point at mem find for the rest.
    const shown = new Set([...bugIds, ...diffMatched.map((r) => r.id)]);
    const rest = open
      .filter((r) => !shown.has(r.id))
      .sort((a, b) => b.ts.localeCompare(a.ts));
    if (rest.length) {
      console.log(`\n## recent open`);
      for (const r of rest.slice(0, RECENT_OPEN_LIMIT))
        console.log(fmtRow({ ...r, text: shortText(r.text) }, claims));
      if (rest.length > RECENT_OPEN_LIMIT)
        console.log(
          `… +${rest.length - RECENT_OPEN_LIMIT} more — \`fapony mem find <word>\` for the rest`,
        );
    }

    // recent closes, plan sweep, rotate — after next up
    kickoffExtras = () => {
      console.log(`\n## recent\n${doneLines(all, 10).join("\n")}`);
      const sweep = planSweepLine();
      if (sweep) console.log(sweep);
      const rotate = rotateLine(all.length);
      if (rotate) console.log(rotate);
    };
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
    // The spec is also a plan file on disk — say whether the last ticked
    // chunk actually closed (chunk 9). Silent when it verifies.
    if (planFile) {
      const hint = closureHint(planChecked);
      if (hint) console.log(`\n${hint}`);
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
  } else if (planFile) {
    const title = readPlanTitle(planFile);
    console.log(`# ${title || basename(planFile)} — plan`);
    const ignored = ignoredLogLine();
    if (ignored) console.log(ignored);
    if (planCheckboxes.length) {
      console.log(
        `\n## unchecked\n${planCheckboxes.map((c) => `- [ ] ${c}`).join("\n")}`,
      );
    } else {
      console.log(`\n(all chunks checked — ready to ship or archive)`);
    }
    // Whether the last ticked chunk actually closed (chunk 9) — one line,
    // silent when its sha verifies.
    const hint = closureHint(planChecked);
    if (hint) console.log(hint);
  } else if (arg) {
    console.error(`no id "${arg}" in the log`);
    process.exit(1);
  }

  // For non-no-args paths, print next up at the end
  if (arg || planFile) printNextUp();

  // Deferred output from no-args path (recent closes, plan sweep, rotate)
  kickoffExtras?.();
};
