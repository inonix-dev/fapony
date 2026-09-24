// src/init.ts — scaffold fapony project structure at a target path.
// Creates .fapony/plan/, .fapony/done/, .fapony/spec/, .fapony/.memory/ (from template).
// state.db stays in ~/.config/fapony/ by design (security boundary — see db.ts),
// never inside the worktree where agents have full write access.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { seedConventionsFile } from "./conventions-seed.js";
import {
  type Config,
  doneDir,
  evidenceFile,
  FAPONY_DIR,
  memoryDir,
  planDir,
  specDir,
} from "./core/config.js";
import { isAffirmative } from "./util.js";

const FAPONY_README = `# .fapony/ — fapony project dir (plans, specs, memory)
# plan/ holds live plans, done/ the shipped ones, spec/ every spec (specs are a
# reference library — they are not archived). done/ sits beside plan/ rather
# than inside it so archiving never changes a file's depth, and the relative
# links inside it keep working.
# memory lives in .fapony/.memory/, the evidence allowlist in .fapony/evidence.json.
#
# evidence.json SHOULD be committed — it is the shared allowlist that decides
# which commands 'fapony report' may run, and the team must run the same
# set. If your .gitignore ignores .fapony/ wholesale, re-include it:
#   **/.fapony/*
#   !**/.fapony/evidence.json
# (dir before file — git cannot re-include a file inside an excluded dir;
# patterns with a mid-string slash anchor at the repo root, so keep the **/).
#
# state.db is NOT here by design — it lives in ~/.config/fapony/ where agents
# running in this worktree cannot rewrite run state / audit trail.
#
# Ask your agent for the plan picture instead of listing these by hand:
#   run "fapony mem kickoff" — priority plans, the first unchecked chunk, open bugs
`;

// Static template — deliberately NOT derived from the repo (reading package.json
// etc. to guess commands would produce a fake allowlist, which is worse than none).
// `fapony report` only runs commands listed here; agent-proposed commands
// outside the allowlist are reported, never executed.
const EVIDENCE_JSON = `{
  "commands": [
    { "name": "test", "cmd": "echo 'edit me: the real test command'", "timeout_ms": 30000 },
    { "name": "typecheck", "cmd": "echo 'edit me: the real typecheck command'", "timeout_ms": 30000 }
  ]
}
`;

// Rules snippet for the user's own agent-rules file. Nothing writes
// log.<person>.jsonl on its own — an agent does, because the rules file it already
// reads says to. That file is the user's, so init asks before writing it (rule 6c)
// and never writes it twice (RULES_MARKER). Not in SERVER_INSTRUCTIONS either: that
// reaches every MCP session of every user, and most of them never ran `fapony init`
// — it would tell them to run a command that does not exist.
const RULES_MARKER = "## Memory: .fapony/.memory";
const RULES_SNIPPET = () => `${RULES_MARKER}/log.<you>.jsonl (append-only)

The log is this project's shared brain — it lives in git, so anyone who clones the
repo gets every decision, bug and note with it. The filename comes from
\`git config user.name\` — one file per person, and \`*.jsonl merge=union\` in
.gitattributes keeps both sides when two people end up sharing a name anyway.

Log as you work — do not wait to be asked. Nothing writes it for you. With the
fapony MCP server connected, call mem_add / mem_find / mem_close directly;
otherwise the CLI:

    fapony mem kickoff <plan.md>      # start a session with this
    fapony mem add decision "what was locked, and why" --files src/x.ts
    fapony mem add bug "what is broken" --files src/x.ts
    fapony mem add note "state the next session needs" --files src/x.ts
    fapony mem close <id> "fixed in <sha>"
    fapony mem find "<text>"

What goes in — would someone cloning this repo tomorrow need it, and can they not
find it anywhere else?
- bug — something broken, even when found mid-task on something else: add it now,
  not at the end. Once fixed, close it — only close closes a bug.
- decision — something agreed or locked that git and the plan do not say, with why.
- note — state the next session needs (where a chunk stopped, what is half-done).
Before ending a turn that committed work: at least one row about it.

Write each entry standalone — it is read months later with no chat to refer to.
--files is required: rows that name no file cannot be recalled when that file is
touched later (add refuses without it).

## Executing a plan chunk-by-chunk

A long plan run in one unbroken session accumulates context with nothing to shrink
it — token cost and coherence both degrade with session length, not with amount of
work done. Cut at chunk boundaries instead:

Finish a chunk, before starting the next:
1. Tick its checkbox + stamp the TL;DR in the plan file
2. Commit — separate from other chunks
3. \`fapony mem add note "what the next chunk needs" --files f1,f2 <path/to/PLAN-x.md>\`
   — use the same plan path every time
4. Stop. Do not continue to the next chunk in the same session unless told to.

Next chunk, new session — open with \`fapony mem kickoff <path/to/PLAN-x.md>\` instead
of carrying the old transcript forward. kickoff already filters to the rows for that plan,
and takes just the filename (\`kickoff PLAN-x.md\`) when you do not want to type the path.`;

export function initProject(targetPath: string, config?: Config): void {
  // Create target root
  mkdirSync(targetPath, { recursive: true });

  // --- .fapony/ marker ---
  const faponyDir = join(targetPath, FAPONY_DIR);
  if (existsSync(faponyDir)) {
    throw new Error(
      `${faponyDir} already exists — delete it first if you want a fresh scaffold.`,
    );
  }
  mkdirSync(faponyDir, { recursive: true });
  writeFileSync(join(faponyDir, "README"), FAPONY_README);

  // --- .gitattributes: union-merge the append-only logs ---
  //
  // Every row is one person's append, so both sides of a "conflict" are always
  // right. Without the line, two people whose git user.name collides (admin /
  // user / owner — what a fresh OS install offers) resolve a conflict by hand
  // on every pull. Appended, never rewritten: the file is the repo's, not ours.
  const attrs = join(targetPath, ".gitattributes");
  const attrsBody = existsSync(attrs) ? readFileSync(attrs, "utf-8") : "";
  if (!/^\s*\*\.jsonl\s+merge=union\s*$/m.test(attrsBody)) {
    appendFileSync(
      attrs,
      `${attrsBody && !attrsBody.endsWith("\n") ? "\n" : ""}# append-only memory logs: keep both sides, never hand-resolve\n*.jsonl merge=union\n`,
    );
    console.log(`  + ${attrs} — *.jsonl merge=union`);
  }

  // --- evidence.json (verification_report allowlist — see src/mcp/evidence.ts) ---
  const evidencePath = join(targetPath, evidenceFile(config));
  if (existsSync(evidencePath)) {
    throw new Error(`${evidencePath} already exists — not overwriting.`);
  }
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, EVIDENCE_JSON);

  // --- plan/ spec/ .memory/ — all under .fapony/ ---
  const planDirAbs = join(targetPath, planDir());
  if (existsSync(planDirAbs)) {
    throw new Error(`${planDirAbs} already exists — not overwriting.`);
  }
  mkdirSync(planDirAbs, { recursive: true });

  // --- done/ (archive, sibling of plan/) ---
  const doneDirAbs = join(targetPath, doneDir(config));
  if (existsSync(doneDirAbs)) {
    throw new Error(`${doneDirAbs} already exists — not overwriting.`);
  }
  mkdirSync(doneDirAbs, { recursive: true });

  // --- spec/ ---
  const specDirAbs = join(targetPath, specDir());
  if (existsSync(specDirAbs)) {
    throw new Error(`${specDirAbs} already exists — not overwriting.`);
  }
  mkdirSync(specDirAbs, { recursive: true });

  // --- .fapony/.memory/ (empty dir — mem commands are built into fapony now) ---
  const memoryDirPath = join(targetPath, memoryDir(config));
  if (existsSync(memoryDirPath)) {
    console.log(`  ${relative(targetPath, memoryDirPath)}/ — already exists`);
  } else {
    mkdirSync(memoryDirPath, { recursive: true });
    console.log(
      `  ${relative(targetPath, memoryDirPath)}/ — mem commands are built into fapony (fapony mem ...)`,
    );
  }

  console.log(`scaffolded ${targetPath}/`);
  console.log(
    `  .fapony/         — project dir (plans, specs, memory, evidence)`,
  );
  console.log(`  ${planDir()}/    — live plan files`);
  console.log(`  ${doneDir(config)}/    — shipped plans (archive)`);
  console.log(`  ${specDir()}/    — spec files`);
  console.log(
    `  ${evidenceFile(config)}    — allowlist for 'fapony report' (edit the cmds!)`,
  );
  console.log(
    `  ${relative(targetPath, memoryDirPath)}/ — mem commands are built into fapony (fapony mem ...)`,
  );
  console.log(`\nNext: add "${targetPath}" to fapony.config.json worktrees`);
  console.log(
    `\nThe memory log only fills up if the rules your agent already reads tell it\nto write — these go into CLAUDE.md / AGENTS.md next:\n`,
  );
  console.log(RULES_SNIPPET());
}

const AGENT_RULE_FILES = ["CLAUDE.md", "AGENTS.md"];

/** Which rules files init would touch: existing ones lacking the rules, or create. */
export function rulesTargets(targetPath: string): {
  create: boolean;
  append: string[];
} {
  const found = AGENT_RULE_FILES.map((f) => join(targetPath, f)).filter(
    existsSync,
  );
  const has = (f: string) => readFileSync(f, "utf-8").includes(RULES_MARKER);
  const agents = join(targetPath, "AGENTS.md");
  // a CLAUDE.md that imports a rules-carrying AGENTS.md already has them
  const covered = (f: string) =>
    has(f) ||
    (/^@AGENTS\.md\s*$/m.test(readFileSync(f, "utf-8")) &&
      existsSync(agents) &&
      has(agents));
  return {
    create: found.length === 0,
    append: found.filter((f) => !covered(f)),
  };
}

/**
 * Write the memory rules into the agent-rules files. No file yet = AGENTS.md
 * (read by OpenCode/Codex/Cursor) + a CLAUDE.md that imports it, so the rules
 * exist once. Files that already carry the rules are left alone.
 */
export function writeRules(targetPath: string): void {
  const { create, append } = rulesTargets(targetPath);
  if (create) {
    writeFileSync(join(targetPath, "AGENTS.md"), `${RULES_SNIPPET()}\n`);
    writeFileSync(join(targetPath, "CLAUDE.md"), "@AGENTS.md\n");
    console.log("  + AGENTS.md (memory rules) · CLAUDE.md → @AGENTS.md");
    return;
  }
  for (const f of append) {
    const body = readFileSync(f, "utf-8");
    appendFileSync(
      f,
      `${body.endsWith("\n") ? "\n" : "\n\n"}${RULES_SNIPPET()}\n`,
    );
    console.log(`  appended memory rules to ${relative(targetPath, f)}`);
  }
}

export async function cmdInit(args: string[]): Promise<void> {
  const rulesOnly = args.includes("--rules");
  const yes = args.includes("--yes");
  const targetPath = args.find((a) => !a.startsWith("--"));
  if (!targetPath) {
    console.error("usage: fapony init <path> [--rules] [--yes]");
    console.error(
      "  --rules  only write the memory rules into CLAUDE.md / AGENTS.md (repo already set up)",
    );
    console.error("  --yes    write them without asking");
    process.exit(1);
  }
  if (!rulesOnly) {
    try {
      initProject(targetPath);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    // --- conventions.json fill-signal (PLAN-convention-debt chunk 2) ---
    // eslint no-restricted-* rows carry their checker; the wrapper detector adds
    // live-migration candidates. Nothing derivable = empty file, never an error.
    const seed = await seedConventionsFile(targetPath);
    if (seed.kept) {
      console.log(
        `  ${relative(targetPath, seed.file)} — already exists, left untouched`,
      );
    } else {
      console.log(
        `  ${relative(targetPath, seed.file)} — ${seed.eslintRows} from eslint, ${seed.wrapperRows} from wrappers`,
      );
      console.log(
        `    'fapony debt' reads it; commit it (!**/.fapony/conventions.json in .gitignore)`,
      );
    }
    for (const s of seed.skipped) console.log(`    ⚠ eslint config ${s}`);
  }

  const { create, append } = rulesTargets(targetPath);
  if (!create && append.length === 0) {
    console.log("  memory rules already in the agent-rules file");
    return;
  }
  if (!yes) {
    const what = create
      ? "Create AGENTS.md with the memory-logging rules (+ CLAUDE.md → @AGENTS.md)"
      : `Append the memory-logging rules to ${append.map((f) => relative(targetPath, f)).join(" and ")}`;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`\n${what}? [y/N] `, (a) => {
        rl.close();
        resolve(a.trim());
      });
    });
    if (!isAffirmative(answer)) return;
  }
  writeRules(targetPath);
}
