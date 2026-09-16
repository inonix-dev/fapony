// src/review-seed.ts — `fapony review-seed [--staged|--commit <sha>|--range <a...b>|--files f1,f2|--plan <PLAN.md>]`
//
// Seeds a code review with the deterministic facts of the scope the agent
// asked about: which files changed (per the exact git expression, echoed),
// who statically imports them, whether any test file touches them, and what
// the current signatures are. The agent is left with verification only —
// walk the diff, run the tests, kill findings as normal.
//
// Read-only stdout: no file writes, no cache, no state.db read — the seed is
// a lens, not a delivery (rule 5b — a command that reads code writes only to a
// path the user pointed at, and this one accepts no such path). This used to
// cite rule 5 "never write into a target worktree", dropped 2026-09-17 because
// four commands broke it; being read-only was always a property of this
// command, never of that rule. Facts only: nothing here says broken/fixed
// — judgment lives in the reviewer and the ledger (verdict_submit), never in
// this output. Deterministic: same input, same bytes, no LLM.
//
// Composes existing producers — buildGraph (analyze.ts) for importers/untested,
// extractExports (map.ts) for signatures. One flag = one declared git call;
// no magic parsing.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGraph,
  type ImportGraph,
  isTestFile,
  SCAN_EXTS,
} from "./analyze.js";
import { extractExports } from "./map.js";
import { assertSafe } from "./safety.js";

const WRAP_WIDTH = 88;
const MAX_CHANGED_LINES = 3;
const MAX_IMPORTER_LINES = 4;
const MAX_SIGNATURE_LINES = 4;
const MAX_IMPORTERS_SHOWN = 4;
const MAX_SIGNATURES_SHOWN = 5;
const MAX_DYNAMIC_LINES = 2;
const MAX_CROSS_CHECK_LINES = 2;
const OUTPUT_CAP = 30;
// Signature text cap per symbol (same trim as map.ts's file view).
const SIG_MAX = 90;
const DISCLAIMER =
  "static graph only — seed is where to enter, not what is verified";
const USAGE =
  "usage: fapony review-seed [--staged | --commit <sha> | --range <a...b> | --files f1,f2 | --plan <PLAN.md>]";

export class SeedError extends Error {}

// --- Git helpers (same shape as collect.ts execGitSafe) ---

function execGit(
  cmd: string,
  cwd: string,
): { ok: boolean; output: string; error?: string } {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    return { ok: true, output: output.trim() };
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return {
      ok: false,
      output: "",
      error: (err.stderr ?? err.message ?? "").trim(),
    };
  }
}

// A scope's primary git call failing must never masquerade as "nothing
// changed" — surface it. merge-base failures are tolerated (label fallback).
function gitOk(r: { ok: boolean; error?: string }, cmd: string): void {
  if (!r.ok)
    throw new SeedError(
      `review-seed: git failed: ${cmd}\n${r.error ?? "unknown error"}`,
    );
}

// Values interpolated into a git command line must be plain refs/paths —
// blocks shell metacharacters before execSync ever sees them.
const GIT_VALUE_RE = /^[A-Za-z0-9._/{}^~+-]+$/;

function gitValue(kind: string, value: string): string {
  if (!GIT_VALUE_RE.test(value)) {
    throw new SeedError(`review-seed: invalid ${kind}: ${value}`);
  }
  return value;
}

// --- Scope flags: exactly one source of scope ---

type Scope =
  | { kind: "default" }
  | { kind: "staged" }
  | { kind: "commit"; sha: string }
  | { kind: "range"; expr: string }
  | { kind: "files"; list: string[] }
  | { kind: "plan"; path: string };

function parseScope(args: string[]): Scope {
  const flags: Scope[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = (): string => {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) {
        throw new SeedError(`review-seed: ${a} needs a value\n${USAGE}`);
      }
      i++;
      return v;
    };
    if (a === "--staged") flags.push({ kind: "staged" });
    else if (a === "--commit") {
      const v = value();
      gitValue("commit ref", v);
      flags.push({ kind: "commit", sha: v });
    } else if (a === "--range") {
      const v = value();
      gitValue("range", v);
      if (!v.includes("...")) {
        throw new SeedError(
          `review-seed: --range wants three-dot (merge-base, PR semantics): a...b\n${USAGE}`,
        );
      }
      flags.push({ kind: "range", expr: v });
    } else if (a === "--files") {
      const list = value()
        .split(",")
        .map((s) => s.trim().replace(/^\.\//, ""))
        .filter(Boolean);
      if (list.length === 0) {
        throw new SeedError(
          `review-seed: --files needs at least one path\n${USAGE}`,
        );
      }
      flags.push({ kind: "files", list });
    } else if (a === "--plan") {
      flags.push({ kind: "plan", path: value() });
    } else if (a === "-h" || a === "--help") {
      throw new SeedError(USAGE);
    } else {
      throw new SeedError(`review-seed: unknown argument "${a}"\n${USAGE}`);
    }
  }
  if (flags.length === 0) return { kind: "default" };
  if (flags.length > 1) {
    throw new SeedError(
      `review-seed: one scope flag at a time (got ${flags.map((f) => f.kind).join(", ")})\n${USAGE}`,
    );
  }
  return flags[0];
}

// --- Scope resolution: one flag = one declared git call ---

interface FileEntry {
  path: string;
  ins: number | null;
  del: number | null;
  untracked: boolean;
  /** Set when -M paired this path with a deleted source (a rename). */
  renamedFrom?: string;
}

interface ResolvedScope {
  label: string;
  entries: FileEntry[];
  /** For --plan: default-diff paths, for the cross-check. */
  crossCheck?: { planFiles: string[]; changed: string[] };
}

// numstat with -M reports renames as `old => new` (whole path) or git's
// brace form `prefix/{old => new}/suffix` (only the moved segment) — expand
// both back to full paths so downstream sections see the real new path plus
// a renamedFrom annotation, never git's internal syntax.
function parseNumstat(output: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const [ins, del, ...rest] = line.split("\t");
    let path = rest.join("\t");
    if (!path) continue;
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    let renamedFrom: string | undefined;
    const brace = /\{([^{}]*) => ([^{}]*)\}/.exec(path);
    if (brace) {
      renamedFrom = path.replace(brace[0], brace[1]);
      path = path.replace(brace[0], brace[2]);
    } else if (path.includes(" => ")) {
      const arrow = path.indexOf(" => ");
      renamedFrom = path.slice(0, arrow);
      path = path.slice(arrow + 4);
    }
    out.push({
      path,
      ins: ins === "-" ? null : Number.parseInt(ins, 10),
      del: del === "-" ? null : Number.parseInt(del, 10),
      untracked: false,
      ...(renamedFrom !== undefined ? { renamedFrom } : {}),
    });
  }
  return out;
}

// untracked paths, one per file — -uall stops git collapsing an untracked
// directory to "dir/" (a seed wants file names, and the collapsed dir breaks
// plan cross-check path equality).
function untrackedFiles(porcelain: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const line of porcelain.split("\n").filter(Boolean)) {
    if (!line.startsWith("?? ")) continue;
    let path = line.slice(3);
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    out.push({ path, ins: null, del: null, untracked: true });
  }
  return out;
}

function shortSha(cwd: string, ref: string): string | null {
  const r = execGit(`git rev-parse --short ${ref}`, cwd);
  return r.ok ? r.output.split("\n")[0] : null;
}

function resolveScope(scope: Scope, cwd: string): ResolvedScope {
  if (scope.kind === "files") {
    return {
      label: "--files (as given)",
      entries: scope.list.map((p) => ({
        path: p,
        ins: null,
        del: null,
        untracked: false,
      })),
    };
  }
  if (scope.kind === "plan") {
    const planPath = join(cwd, scope.path);
    if (!existsSync(planPath)) {
      throw new SeedError(`review-seed: plan file not found: ${scope.path}`);
    }
    const planFiles = planFrontFiles(readFileSync(planPath, "utf-8"));
    if (planFiles === null) {
      // No files[] to scope from — fall back to the default diff, say so.
      const entries = [
        ...parseNumstat(execGit("git diff HEAD --numstat -M", cwd).output),
        ...untrackedFiles(execGit("git status --porcelain -uall", cwd).output),
      ];
      return {
        label: "--plan (no files: frontmatter) — diff HEAD + untracked",
        entries,
      };
    }
    // Cross-check target is the default diff — one declared git call.
    const changed = [
      ...parseNumstat(execGit("git diff HEAD --numstat -M", cwd).output),
      ...untrackedFiles(execGit("git status --porcelain -uall", cwd).output),
    ].map((e) => e.path);
    const shortA = shortSha(cwd, "HEAD");
    return {
      label: `--plan ${scope.path}${shortA ? ` (HEAD = ${shortA})` : ""}`,
      entries: planFiles.map((p) => ({
        path: p,
        ins: null,
        del: null,
        untracked: false,
      })),
      crossCheck: { planFiles, changed: [...new Set(changed)].sort() },
    };
  }
  if (scope.kind === "default") {
    const diff = execGit("git diff HEAD --numstat -M", cwd);
    gitOk(diff, "git diff HEAD --numstat -M");
    const st = execGit("git status --porcelain -uall", cwd);
    gitOk(st, "git status --porcelain -uall");
    const entries = [
      ...parseNumstat(diff.output),
      ...untrackedFiles(st.output),
    ];
    return { label: "diff HEAD + untracked", entries };
  }
  if (scope.kind === "staged") {
    const diff = execGit("git diff --cached --numstat -M", cwd);
    gitOk(diff, "git diff --cached --numstat -M");
    return {
      label: "--staged (diff --cached)",
      entries: parseNumstat(diff.output),
    };
  }
  if (scope.kind === "commit") {
    const sha = scope.sha;
    const verify = execGit(`git rev-parse --verify ${sha}^{commit}`, cwd);
    if (!verify.ok) throw new SeedError(`review-seed: not a commit: ${sha}`);
    const short = shortSha(cwd, sha) ?? sha;
    const parent = execGit(`git rev-parse --verify ${sha}^`, cwd);
    if (!parent.ok) {
      // Root commit — no parent to diff against; tree vs empty tree instead.
      const entries = parseNumstat(
        execGit(`git diff-tree --no-commit-id --numstat -r --root ${sha}`, cwd)
          .output,
      );
      return {
        label: `--commit ${short} (root commit — vs empty tree)`,
        entries,
      };
    }
    const parentShort = shortSha(cwd, `${sha}^`) ?? parent.output.slice(0, 7);
    const diff = execGit(`git diff ${sha}^ ${sha} --numstat -M`, cwd);
    gitOk(diff, `git diff ${sha}^ ${sha} --numstat -M`);
    return {
      label: `--commit ${short} (${parentShort}..${short})`,
      entries: parseNumstat(diff.output),
    };
  }
  // range
  const expr = scope.expr;
  const mb = execGit(`git merge-base ${expr.replace("...", " ")}`, cwd);
  const tipShort = shortSha(cwd, expr.split("...")[1]) ?? expr.split("...")[1];
  const baseShort = mb.ok ? (shortSha(cwd, mb.output) ?? "?") : null;
  const diff = execGit(`git diff ${expr} --numstat -M`, cwd);
  gitOk(diff, `git diff ${expr} --numstat -M`);
  return {
    label: baseShort ? `${expr} = ${baseShort}…${tipShort}` : `--range ${expr}`,
    entries: parseNumstat(diff.output),
  };
}

// --- Plan frontmatter files[] (same flat-key style as plans.ts parseFront) ---

function planFrontFiles(text: string): string[] | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (kv?.[1] !== "files") continue;
    const value = kv[2].replace(/\s+#.*$/, "").trim();
    if (!value) return null;
    const list = value
      .split(",")
      .map((s) => s.trim().replace(/^\.\//, ""))
      .filter(Boolean);
    return list.length > 0 ? list : null;
  }
  return null;
}

// --- Structure lines (facts from the static graph) ---

function wrap(parts: string[], joiner: string, indent: string): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const p of parts) {
    const piece = cur ? `${cur}${joiner}${p}` : p;
    if (piece.length > WRAP_WIDTH && cur) {
      lines.push(`${indent}${cur}`);
      cur = p;
    } else {
      cur = piece;
    }
  }
  if (cur) lines.push(`${indent}${cur}`);
  return lines;
}

function fmtCounts(e: FileEntry): string {
  const rename = e.renamedFrom ? ` (renamed from ${e.renamedFrom})` : "";
  if (e.untracked) return " (untracked)";
  if (e.ins === null || e.del === null) return rename || " (as given)";
  if (e.ins === 0 && e.del === 0) return rename;
  return ` +${e.ins}-${e.del}${rename}`;
}

function hasDynamicDispatch(absFile: string): boolean {
  let content: string;
  try {
    content = readFileSync(absFile, "utf-8");
  } catch {
    return false;
  }
  return /\b(?:import|require)\s*\(/.test(content);
}

export function renderSeed(args: string[], cwd: string): string {
  const scope = parseScope(args);
  const root = execGit("git rev-parse --show-toplevel", cwd);
  if (!root.ok) {
    throw new SeedError("review-seed: not a git repository (no worktree root)");
  }
  try {
    assertSafe(args);
  } catch (e) {
    throw new SeedError(
      e instanceof Error ? e.message : "refused dangerous argument",
    );
  }
  const worktree = root.output.split("\n")[0];
  const resolved = resolveScope(scope, worktree);
  const entries = [...resolved.entries].sort((a, b) =>
    a.path < b.path ? -1 : 1,
  );

  // Static graph over the whole worktree — same producer as `fapony analyze`.
  let graph: ImportGraph | null = null;
  try {
    graph = buildGraph(worktree);
  } catch {
    graph = null;
  }
  const testFiles = graph ? graph.files.filter((f) => isTestFile(f)).length : 0;

  const structureTargets = entries.filter((e) => {
    if (isTestFile(e.path)) return false;
    // SCAN_EXTS keys carry the dot (".ts") — slice from the dot itself.
    const dot = e.path.lastIndexOf(".");
    if (dot < 0 || !SCAN_EXTS.has(e.path.slice(dot))) return false;
    return existsSync(join(worktree, e.path));
  });

  const lines: string[] = [];
  lines.push(`worktree: ${worktree} (${resolved.label})`);

  const changedParts = entries.map((e) => `${e.path}${fmtCounts(e)}`);
  const changedLines = wrap(changedParts, " · ", "  ");
  if (entries.length === 0) {
    lines.push("changed (0): nothing in this scope");
  } else {
    lines.push(`changed (${entries.length}):`);
    for (const l of changedLines.slice(0, MAX_CHANGED_LINES)) lines.push(l);
    if (changedLines.length > MAX_CHANGED_LINES) {
      lines.push(
        `  … +${changedLines.length - MAX_CHANGED_LINES} more changed lines`,
      );
    }
  }

  if (!graph) {
    lines.push(
      "graph: scan failed — importers/untested/signatures unavailable",
    );
  } else if (structureTargets.length > 0) {
    const importerLines: string[] = [];
    for (const e of structureTargets) {
      const deps = [
        ...(graph.dependents.get(e.path) ?? new Set<string>()),
      ].sort();
      if (deps.length === 0) continue;
      const shown = deps.slice(0, MAX_IMPORTERS_SHOWN).join(", ");
      const rest =
        deps.length > MAX_IMPORTERS_SHOWN
          ? ` (+${deps.length - MAX_IMPORTERS_SHOWN})`
          : "";
      importerLines.push(`  ${e.path} ← ${shown}${rest}`);
    }
    if (importerLines.length > 0) {
      lines.push("importers (static):");
      for (const l of importerLines.slice(0, MAX_IMPORTER_LINES)) lines.push(l);
      if (importerLines.length > MAX_IMPORTER_LINES) {
        lines.push(`  … +${importerLines.length - MAX_IMPORTER_LINES} more`);
      }
    }

    const untested = structureTargets.filter((e) => {
      const deps = graph?.dependents.get(e.path) ?? new Set<string>();
      return ![...deps].some(isTestFile);
    });
    if (testFiles === 0) {
      lines.push("untested: repo has no test files — flag uninformative");
    } else if (untested.length > 0) {
      const wrapped = wrap(
        untested.map((e) => e.path),
        ", ",
        "  ",
      );
      lines.push(`untested (${untested.length}):`);
      lines.push(...wrapped.slice(0, 2));
      if (wrapped.length > 2) lines.push(`  … +${wrapped.length - 2} more`);
    }

    const sigLines: string[] = [];
    for (const e of structureTargets) {
      let source: string;
      try {
        source = readFileSync(join(worktree, e.path), "utf-8");
      } catch {
        continue;
      }
      const scan = extractExports(source);
      if (scan.error) {
        sigLines.push(`  ${e.path} — ⚠ ${scan.error}`);
        continue;
      }
      if (scan.symbols.length === 0) {
        sigLines.push(`  ${e.path} — (no exports)`);
        continue;
      }
      // Real declaration text per symbol — the reviewer checks "did a param
      // change" without opening the file. Same trim as map.ts's file view.
      const srcLines = source.split("\n");
      const shown = scan.symbols
        .slice(0, MAX_SIGNATURES_SHOWN)
        .map((s) => {
          const raw = (srcLines[s.line - 1] ?? "").trim();
          const sig =
            raw.length > SIG_MAX ? `${raw.slice(0, SIG_MAX - 1)}…` : raw;
          return sig ? `${s.name}:${s.line} ${sig}` : `${s.name}:${s.line}`;
        })
        .join(" · ");
      const rest =
        scan.symbols.length > MAX_SIGNATURES_SHOWN
          ? ` (+${scan.symbols.length - MAX_SIGNATURES_SHOWN})`
          : "";
      sigLines.push(`  ${e.path} — ${shown}${rest}`);
    }
    if (sigLines.length > 0) {
      lines.push("signatures (current):");
      for (const l of sigLines.slice(0, MAX_SIGNATURE_LINES)) lines.push(l);
      if (sigLines.length > MAX_SIGNATURE_LINES) {
        lines.push(`  … +${sigLines.length - MAX_SIGNATURE_LINES} more`);
      }
    }

    const dynamic = structureTargets.filter((e) =>
      hasDynamicDispatch(join(worktree, e.path)),
    );
    if (dynamic.length > 0) {
      const wrapped = wrap(
        dynamic.map((e) => e.path),
        ", ",
        "  ",
      );
      lines.push(
        "dynamic-dispatch hint (import(/require( — resolve at runtime):",
      );
      lines.push(...wrapped.slice(0, MAX_DYNAMIC_LINES));
      if (wrapped.length > MAX_DYNAMIC_LINES) {
        lines.push(`  … +${wrapped.length - MAX_DYNAMIC_LINES} more lines`);
      }
    }
  }

  if (resolved.crossCheck) {
    const planSet = new Set(resolved.crossCheck.planFiles);
    const changedSet = new Set(resolved.crossCheck.changed);
    const notInPlan = [...changedSet].filter((f) => !planSet.has(f)).sort();
    const notChanged = resolved.crossCheck.planFiles
      .filter((f) => !changedSet.has(f))
      .sort();
    if (notInPlan.length > 0 || notChanged.length > 0) {
      if (notInPlan.length > 0) {
        const wrapped = wrap(notInPlan, ", ", "  ");
        lines.push("plan cross-check: changed-not-in-plan:");
        lines.push(...wrapped.slice(0, MAX_CROSS_CHECK_LINES));
        if (wrapped.length > MAX_CROSS_CHECK_LINES) {
          lines.push(
            `  … +${wrapped.length - MAX_CROSS_CHECK_LINES} more lines`,
          );
        }
      }
      if (notChanged.length > 0) {
        const wrapped = wrap(notChanged, ", ", "  ");
        lines.push("plan cross-check: in-plan-not-changed:");
        lines.push(...wrapped.slice(0, MAX_CROSS_CHECK_LINES));
        if (wrapped.length > MAX_CROSS_CHECK_LINES) {
          lines.push(
            `  … +${wrapped.length - MAX_CROSS_CHECK_LINES} more lines`,
          );
        }
      }
    }
  } else if (scope.kind === "plan") {
    lines.push("plan cross-check: plan has no files: frontmatter — skipped");
  } else {
    lines.push("plan cross-check: skipped — no --plan flag");
  }

  // Disclaimer is mandatory on every output — reserve its line so cap
  // truncation (below) can never carry it off with the rest of the tail.
  if (lines.length > OUTPUT_CAP - 1) {
    const rest = lines.length - (OUTPUT_CAP - 2);
    lines.length = OUTPUT_CAP - 2;
    lines.push(`… (+${rest} lines truncated)`);
  }
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

export function cmdReviewSeed(args: string[]): void {
  try {
    console.log(renderSeed(args, process.cwd()));
  } catch (e) {
    if (e instanceof SeedError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
