// src/lint-baseline.ts — `fapony lint-baseline`: separate "was red before" from "I made it red".
//
// warnings and errors already red before the agent arrived force the agent to `fix all` first
// and then the real work is buried in one large diff (SPEC-convention-debt §4 — from the owner:
// "138 spots across ~40 files unrelated to the work") the repo's own red count is 212 —
// an agent that did nothing wrong must see **0**
//
// Mechanism — does not know eslint: runs the command the repo declares (--cmd or evidence.json named "lint"),
// parses into a set of `path:rule-id` (**not line numbers** — lines shift every time a file is edited),
// stores the baseline at base_sha · results never enter state.db (2 tables, no additions) —
// it is a temporary file under the state dir and is discarded once --diff reports · report only
// never blocks — the agent decides whether to fix the old issues too

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { faponyDir } from "./db/load.js";
import { assertSafe } from "./safety.js";

const USAGE =
  'usage: fapony lint-baseline --capture [--cmd "<lint command>"]\n' +
  '       fapony lint-baseline --diff [--cmd "<lint command>"]\n' +
  '       (without --cmd, uses the evidence.json command named "lint")';

interface BaselineFile {
  worktree: string;
  baseSha: string;
  ts: string;
  pairs: string[];
}

function worktreeOf(cwd: string): string {
  const p = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) {
    console.error("lint-baseline: not a git repository");
    process.exit(1);
  }
  return p.stdout.toString().trim();
}

function gitSha(cwd: string): string {
  const p = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return p.exitCode === 0 ? p.stdout.toString().trim().slice(0, 12) : "none";
}

function baselinePath(worktree: string): string {
  const key = worktree.replace(/[^A-Za-z0-9._-]+/g, "_");
  return join(faponyDir(), "lint-baseline", `${key}.json`);
}

function readEvidenceLintCmd(worktree: string): string | null {
  const evidence = join(worktree, ".fapony", "evidence.json");
  try {
    const parsed = JSON.parse(readFileSync(evidence, "utf-8")) as {
      commands?: { name?: string; cmd?: string }[];
    };
    const hit = (parsed.commands ?? []).find(
      (c) => c.name === "lint" && typeof c.cmd === "string" && c.cmd.length > 0,
    );
    return hit?.cmd ?? null;
  } catch {
    return null;
  }
}

function runLint(cmd: string, worktree: string): string {
  // --cmd / evidence.json is the repo's own declaration — same trust as
  // `fapony report` running an allowlisted command; deny rules still apply.
  assertSafe(cmd.split(/\s+/));
  try {
    return execSync(cmd, {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    // linters exit non-zero when they find anything — stdout IS the result
    const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
    if (out.trim().length === 0) throw e;
    return out;
  }
}

// --- parsers: eslint JSON first, unix one-liner fallback ---

interface Finding {
  file: string;
  rule: string;
}

function parseEslintJson(output: string, worktree: string): Finding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Finding[] = [];
  for (const f of parsed) {
    const o = f as {
      filePath?: string;
      messages?: { ruleId?: string | null }[];
    };
    if (typeof o.filePath !== "string") continue;
    const rel = relative(worktree, o.filePath);
    for (const m of o.messages ?? []) {
      out.push({
        file: rel.startsWith("..") ? o.filePath : rel,
        rule: m.ruleId ?? "syntax-error",
      });
    }
  }
  return out;
}

// `/abs/file.ts:12:5: message (rule-id)` or trailing ` rule-id` — eslint -f unix,
// and close cousins (golangci-lint, shellcheck -f gcc, …)
const UNIX_LINE_RE = /^(.+?):\d+:\d+:\s+.*?\(?([A-Za-z0-9_@][\w@/.-]*)\)?\s*$/;

function parseUnixLines(output: string, worktree: string): Finding[] {
  const out: Finding[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const m = UNIX_LINE_RE.exec(line.trim());
    if (!m) continue;
    const raw = m[1];
    const abs = raw.startsWith("/") ? raw : join(worktree, raw);
    const rel = relative(worktree, abs);
    out.push({ file: rel.startsWith("..") ? raw : rel, rule: m[2] });
  }
  return out;
}

function parseFindings(
  output: string,
  worktree: string,
): {
  findings: Finding[];
  format: string;
} {
  const asJson = parseEslintJson(output, worktree);
  if (asJson.length > 0) return { findings: asJson, format: "eslint-json" };
  const asLines = parseUnixLines(output, worktree);
  if (asLines.length > 0) return { findings: asLines, format: "unix-lines" };
  return { findings: [], format: output.trim() ? "unknown" : "empty" };
}

function capturePairs(
  cmd: string,
  worktree: string,
): {
  pairs: Set<string>;
  format: string;
} {
  const output = runLint(cmd, worktree);
  const { findings, format } = parseFindings(output, worktree);
  if (format === "unknown") {
    console.error(
      "lint-baseline: could not parse the lint output.\n" +
        "Supported: eslint `-f json` (default in most setups), or one-line\n" +
        "`path:line:col: message (rule-id)` output (eslint -f unix).\n" +
        'Try: --cmd "pnpm exec eslint . -f unix"',
    );
    process.exit(1);
  }
  return { pairs: new Set(findings.map((f) => `${f.file}:${f.rule}`)), format };
}

export function lintBaseline(args: string[], cwd: string): void {
  const mode = args.find((a) => a === "--capture" || a === "--diff");
  if (!mode || args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const cmdIdx = args.indexOf("--cmd");
  let cmd: string | undefined = cmdIdx >= 0 ? args[cmdIdx + 1] : undefined;
  if (!cmd || cmd.startsWith("--")) cmd = undefined;
  const worktree = worktreeOf(cwd);
  if (!cmd) {
    const fromEvidence = readEvidenceLintCmd(worktree);
    if (fromEvidence) cmd = fromEvidence;
  }
  if (!cmd) {
    console.error(
      'lint-baseline: no lint command — pass --cmd "<lint command>" or add\n' +
        '{ "name": "lint", "cmd": "..." } to .fapony/evidence.json',
    );
    process.exit(1);
  }
  console.log(`lint command: ${cmd} (worktree ${worktree})`);

  if (mode === "--capture") {
    const { pairs, format } = capturePairs(cmd, worktree);
    const file = baselinePath(worktree);
    mkdirSync(join(file, ".."), { recursive: true });
    const payload: BaselineFile = {
      worktree,
      baseSha: gitSha(worktree),
      ts: new Date().toISOString(),
      pairs: [...pairs].sort(),
    };
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(
      `captured ${pairs.size} finding(s) (${format}) at ${payload.baseSha} — baseline stored, not in state.db`,
    );
    return;
  }

  // --diff
  const file = baselinePath(worktree);
  let baseline: BaselineFile;
  try {
    baseline = JSON.parse(readFileSync(file, "utf-8")) as BaselineFile;
  } catch {
    console.error(
      "lint-baseline: no baseline captured — run `fapony lint-baseline --capture` first",
    );
    process.exit(1);
  }
  const { pairs, format } = capturePairs(cmd, worktree);
  const mine = [...pairs].filter((p) => !baseline.pairs.includes(p)).sort();
  const fixed = baseline.pairs.filter((p) => !pairs.has(p)).length;
  console.log(
    `baseline ${baseline.pairs.length} finding(s) at ${baseline.baseSha} · now ${pairs.size} (${format})`,
  );
  if (mine.length === 0) {
    console.log("new findings introduced by this work: 0 — clean");
  } else {
    console.log(`new findings introduced by this work: ${mine.length}`);
    for (const p of mine.slice(0, 40)) console.log(`  ${p}`);
    if (mine.length > 40) console.log(`  … +${mine.length - 40} more`);
  }
  if (fixed > 0) {
    console.log(`(also fixed ${fixed} pre-existing finding(s) — thank you)`);
  }
  // temporary by design (SPEC §4) — the baseline has served its run
  rmSync(file, { force: true });
  console.log("baseline discarded — capture again for the next unit of work");
}

export function cmdLintBaseline(args: string[]): void {
  lintBaseline(args, process.cwd());
}
