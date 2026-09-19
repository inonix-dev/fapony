// commands/plan.ts — plan-sweep: find PLAN-*.md whose header says shipped but not yet moved into done/
// rationale: moving by hand = chasing relative links yourself (in the file + files that link to it) → the step gets skipped often
// no arg = report only (safe, shows every kickoff/stale run)
// <file.md> = check a single file, is it ready to move
// <file.md> --apply = git mv + fix markdown links inside the file + fix inbound links from other files in plan/
//                      + warn about plain-text mentions (detect-only, no auto-fix)

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { openRows } from "../selectors.js";
import { doneDir, memCmd, nextId, planDir, put, rel, rows } from "../store.js";

const SHIPPED = /^>\s*✅/m;
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---/;
const HELD = /^status:\s*(blocked|superseded)\b/m;

// the ✅ shipped header is no longer on the first line — the current plan format starts with frontmatter
// then `# title` (see templates/PLAN.md); check the file's head rather than a single first line
//
// frontmatter always beats the ✅ header: a plan that shipped some chunks and is waiting on externals (VPS, users,
// a decision) writes `status: blocked` = it is meant to stay in plan/, not forgotten to move
// if this is not checked, such plans show "shipped but never archived" forever, and people stop reading
// the whole list — the same symptom that kept done/ from ever moving in the first place
export const hasShippedHeader = (file: string): boolean => {
  const head = readFileSync(file, "utf8").slice(0, 2048);
  if (!SHIPPED.test(head)) return false;
  return !HELD.test(FRONT.exec(head)?.[1] ?? "");
};

export const planSweepCmd = `${memCmd} plan-sweep`;

const mdFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? mdFiles(join(dir, e.name))
          : e.name.endsWith(".md")
            ? [join(dir, e.name)]
            : [],
      )
    : [];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// the file moved dir (same content) — an old markdown link meant the old path relative to oldDir, must re-relativize via newDir
// resolve from newDir (where the file is now) — if the target also moved to the same dir → plain filename,
// if the target stayed in oldDir → ../target (both correct)
// pass 1 only — fix only [text](target) markdown links, do not touch plain text
export const rewriteMovedFileLinks = (
  file: string,
  oldDir: string,
  newDir: string,
): number => {
  const src = readFileSync(file, "utf8");
  let n = 0;

  const out = src.replace(/\]\(([^)]+)\)/g, (m, t: string) => {
    const [target, anchor] = t.split("#");
    if (!target || /^(https?:|mailto:|\/)/.test(target)) return m;
    // resolve from where the file IS now (newDir); if target doesn't exist
    // there, fall back to oldDir (target stayed in original location)
    const inNew = resolve(newDir, target);
    const abs = existsSync(inNew) ? inNew : resolve(oldDir, target);
    n++;
    return `](${relative(newDir, abs) || "."}${anchor ? `#${anchor}` : ""})`;
  });

  if (n) writeFileSync(file, out);
  return n;
};

// other files whose links point at the old path (oldAbs) → repoint them at the new path (newAbs)
// pass 1 only — fix only [text](target) markdown links, do not touch plain text
export const rewriteMarkdownLinks = (
  file: string,
  oldAbs: string,
  newAbs: string,
): number => {
  const src = readFileSync(file, "utf8");
  let n = 0;
  const newRel = relative(dirname(file), newAbs) || ".";

  const out = src.replace(/\]\(([^)]+)\)/g, (m, t: string) => {
    const [target, anchor] = t.split("#");
    if (!target || /^(https?:|mailto:|\/)/.test(target)) return m;
    if (resolve(dirname(file), target) !== oldAbs) return m;
    n++;
    return `](${newRel}${anchor ? `#${anchor}` : ""})`;
  });

  if (n) writeFileSync(file, out);
  return n;
};

// count plain-text mentions of the target filename in a file (detect-only, writes nothing)
// regex: not a markdown link [text](url) — catches both with/without the .md extension
// covers: prose, backtick code span, code fence — every context that is not a markdown link
//
// Fix (2026-09-02): strip the whole markdown link [text](target) first (both display text and
// target — not just target), then run the plain-text regex on the remainder, no longer needing
// lookbehind — the old lookbehind `(?<![/\[(])` was meant to stop markdown-link false-positives
// but its side effect was excluding every mention with a leading `/` too (e.g. `done/PLAN-x.md` or
// `apps/vela/plan/PLAN-x.md`) — the real false-negative that slipped through in 6e411042
// The first fix (stripping only `](target)`) missed — it left `[display-text]` unwrapped, making an already
// valid link like `[PLAN-x.md](../done/PLAN-x.md)` (the actual pattern throughout this file) get double-counted as a
// plain-text mention — strip the whole [..](..) block, not just the (..) part
export const countPlainTextMentions = (
  file: string,
  target: string,
): number => {
  const src = readFileSync(file, "utf8");
  const baseName = target.replace(/\.md$/, "");
  const withoutLinks = src.replace(/\[[^\]]*\]\([^)]+\)/g, "");
  const plainRe = new RegExp(
    `\\b${escapeRe(baseName)}(?:\\.md)?\\b(?!\\.\\w)`,
    "g",
  );
  let count = 0;

  while (plainRe.test(withoutLinks)) count++;
  return count;
};

// shared with the dashboard (now/kickoff) — plan/ files with a shipped header but not yet moved into done/
export const shippedNotMoved = (): string[] => {
  const dir = planDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .filter((name) => hasShippedHeader(join(dir, name)));
};

export const cmdPlanSweep = (a: string[]) => {
  const dir = planDir;
  if (!existsSync(dir)) {
    console.log(`no ${rel(dir)}/ — nothing to sweep`);
    return;
  }
  const candidates = shippedNotMoved();

  const target = a.find((x) => x.endsWith(".md"));
  const apply = a.includes("--apply");

  if (!target) {
    if (!candidates.length) {
      console.log(
        `no PLAN with a ✅ shipped header is sitting outside ${rel(doneDir)}/`,
      );
      return;
    }
    const all = rows();
    console.log(
      `# plan-sweep — ${candidates.length} file(s) marked shipped but not archived\n`,
    );
    for (const name of candidates) {
      const spec = `${rel(dir)}/${name}`;
      const openN = openRows(all).filter((r) => r.spec === spec).length;
      const warn = openN
        ? `  ⚠ ${openN} open row(s) (next/bug/hold/decision/note) — check before moving`
        : "";
      console.log(`- ${rel(dir)}/${name}${warn}`);
    }
    console.log(`\nmove: ${planSweepCmd} <file.md> --apply`);
    return;
  }

  const src = join(dir, target);
  if (!existsSync(src)) {
    console.error(`${rel(src)} not found`);
    process.exit(1);
  }
  const shipped = hasShippedHeader(src);
  if (!apply) {
    console.log(
      shipped
        ? `${target}: has a ✅ shipped header — ready to move (add --apply)`
        : `${target}: no ✅ shipped header at the top — check the whole file is actually done`,
    );
    return;
  }

  // ponytail: the old --apply enforced neither of these two conditions — you could pass the dry-run message
  // but then run --apply directly and skip everything → risky when an agent ships automatically with no human check, so hard block
  if (!shipped && !process.env.MEM_FORCE) {
    console.error(
      `${target}: no ✅ shipped header at the top — refusing to move (MEM_FORCE=1 to override)`,
    );
    process.exit(1);
  }
  const openSpec = `${rel(dir)}/${target}`;
  const openN = openRows(rows()).filter((r) => r.spec === openSpec);
  if (openN.length && !process.env.MEM_FORCE) {
    console.error(
      `${target}: still has ${openN.length} open row(s) (next/bug/hold/decision/note) — close them or move the spec first (MEM_FORCE=1 to override):\n` +
        openN.map((r) => `  [${r.id}] ${r.kind} ${r.text}`).join("\n"),
    );
    process.exit(1);
  }

  const dst = join(doneDir, target);
  if (existsSync(dst)) {
    console.error(`${rel(dst)} already exists`);
    process.exit(1);
  }

  // ponytail: a file just written this round may not be git add'ed yet — `git mv` fails silently (exit 128, no throw)
  // then the next code hits ENOENT reading a dst that does not exist — always stage first (no-op if already tracked)
  mkdirSync(doneDir, { recursive: true });
  Bun.spawnSync(["git", "add", src]);
  const mv = Bun.spawnSync(["git", "mv", src, dst]);
  if (mv.exitCode !== 0) {
    console.error(`git mv failed (${mv.stderr.toString().trim()}) — not moved`);
    process.exit(1);
  }

  // done/ is a sibling of plan/ = same depth, links in the file still resolve, no need to touch
  // the old layout (plan/done/) is one level deeper, so it does need re-relativizing
  const nested = dirname(doneDir) !== dirname(dir);
  const ownLinks = nested ? rewriteMovedFileLinks(dst, dir, doneDir) : 0;

  let inbound = 0;
  let inboundFiles = 0;
  for (const f of mdFiles(dir)) {
    if (f === dst) continue;
    const n = rewriteMarkdownLinks(f, src, dst);
    if (n) {
      inbound += n;
      inboundFiles++;
    }
  }

  console.log(`moved ${rel(src)} → ${rel(dst)}`);
  console.log(
    nested
      ? `links rewritten inside the file: ${ownLinks}`
      : `links rewritten inside the file: 0 (same depth, existing links still resolve)`,
  );
  console.log(
    `inbound links rewritten: ${inbound} in ${inboundFiles} file(s) (scanned ${rel(dir)}/** only)`,
  );

  // log decision — record ship event (reuse existing kind, no new schema)
  const doneSpec = `${rel(dst)}`;
  put({
    id: nextId(rows()),
    kind: "decision",
    text: `${target} shipped → ${rel(dst)}`,
    spec: doneSpec,
  });
  // ponytail: this decision *is* the move itself, nothing to write back into the spec — do not mark synced
  // immediately or staleReport shows "decision never made it into the spec" on every ship (seen in kickoff 2026-09-02)
  put({ kind: "synced", spec: doneSpec });

  // plain-text mention detection (detect-only, no auto-fix)
  let plainTextTotal = 0;
  const plainTextFiles: string[] = [];
  for (const f of mdFiles(dir)) {
    const n = countPlainTextMentions(f, target);
    if (n) {
      plainTextTotal += n;
      plainTextFiles.push(f.replace(`${dir}/`, ""));
    }
  }
  if (plainTextTotal > 0) {
    console.log(
      `⚠ ${plainTextTotal} plain-text mention(s) in ${plainTextFiles.length} file(s) under ${rel(dir)}/ — grep and update the paths yourself:\n${plainTextFiles.join("\n")}`,
    );
  }

  // files outside plan/ that mention the target — detect-only
  const grep = Bun.spawnSync([
    "git",
    "grep",
    "-l",
    target,
    "--",
    // the "files outside plan/" scope = the folder plan/ lives under (apps/vela, .fapony, …)
    rel(dirname(planDir)),
    `:!${rel(dir)}`,
  ])
    .stdout.toString()
    .trim();
  if (grep)
    console.log(
      `⚠ files outside ${rel(dir)}/ still mention "${target}" — check them yourself (not auto-fixed):\n${grep}`,
    );
};

// plan-check — list active PLANs + detect shipped-not-moved + broken links
// exit 0 = clean, 1 = issues found
export const cmdPlanCheck = (a: string[]) => {
  const quiet = a.includes("--quiet");
  const dir = planDir;
  if (!existsSync(dir)) {
    if (!quiet) console.log(`no ${rel(dir)}/ — skip`);
    return;
  }

  const issues: string[] = [];

  // 1) List active PLANs
  const active = mdFiles(dir).filter((f) => !f.includes("/done/"));
  if (!quiet) {
    console.log(`${rel(dir)}/ — ${active.length} file(s) (active)\n`);
  }

  // 2) Shipped-not-moved check
  const shipped = shippedNotMoved();
  for (const name of shipped) {
    issues.push(
      `${name} — has a shipped header but was never archived\n   fix: ${planSweepCmd} ${name} --apply`,
    );
  }

  // 3) Broken link check — resolve [text](target) where target is in plan/**
  //    only check active files (not done/) — done/ files are historical snapshots with external refs
  const linkRe = /\]\(([^)]+)\)/g;
  for (const f of active) {
    // strip fenced blocks + inline code first (replace with spaces to preserve line offset) —
    // example links in code (e.g. this tool's own spec) must not be counted as real links
    const src = readFileSync(f, "utf8")
      .replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, " "))
      .replace(/`[^`\n]*`/g, (b) => " ".repeat(b.length));
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(src)) !== null) {
      const target = m[1];
      if (!target || /^(https?:|mailto:|\/)/.test(target)) continue;
      const [pathPart] = target.split("#");
      if (!pathPart) continue;
      const resolved = resolve(dirname(f), pathPart);
      if (!resolved.startsWith(dir)) continue; // only check links within plan/
      if (!existsSync(resolved)) {
        const rel = f.replace(`${dir}/`, "");
        const line = src.slice(0, m.index).split("\n").length;
        issues.push(
          `${rel}:${line} — broken link → ${target} (no such file in plan/)\n   fix: correct the path or create the file it points at`,
        );
      }
    }
  }

  if (issues.length === 0) {
    if (!quiet) console.log("✅ clean");
    process.exit(0);
  }

  console.error(`🚨 ${issues.length} issue(s):\n`);
  for (let i = 0; i < issues.length; i++) {
    console.error(`${i + 1}. ${issues[i]}\n`);
  }
  process.exit(1);
};
