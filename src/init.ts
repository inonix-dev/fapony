// src/init.ts — scaffold fapony project structure at a target path.
// Creates .fapony/plan/, .fapony/done/, .fapony/spec/, .fapony/.memory/ (from template).
// state.db stays in ~/.config/fapony/ by design (security boundary — see db.ts),
// never inside the worktree where agents have full write access.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  type Config,
  doneDir,
  evidenceFile,
  memoryEntry,
  planDir,
  specDir,
} from "./db/index.js";
import { copyDir } from "./init-mem.js";

const FAPONY_README = `# .fapony/ — fapony project dir (plans, specs, memory)
# plan/ holds live plans, done/ the shipped ones, spec/ every spec (specs are a
# reference library — they are not archived). done/ sits beside plan/ rather
# than inside it so archiving never changes a file's depth, and the relative
# links inside it keep working.
# memory lives in .fapony/.memory/, the evidence allowlist in .fapony/evidence.json.
#
# evidence.json SHOULD be committed — it is the shared allowlist that decides
# which commands verification_report may run, and the team must run the same
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
#   "run plan_list" — what is active, blocked, untouched, archived
`;

// Static template — deliberately NOT derived from the repo (reading package.json
// etc. to guess commands would produce a fake allowlist, which is worse than none).
// verification_report only runs commands listed here; agent-proposed commands
// outside the allowlist are reported, never executed.
const EVIDENCE_JSON = `{
  "commands": [
    { "name": "test", "cmd": "echo 'edit me: the real test command'", "timeout_ms": 30000 },
    { "name": "typecheck", "cmd": "echo 'edit me: the real typecheck command'", "timeout_ms": 30000 }
  ]
}
`;

// Rules snippet for the user's own agent-rules file. Printed, never written:
// nothing writes log.<person>.jsonl on its own — an agent does, because the rules
// file it already reads says to. That file is the user's (CLAUDE.md / AGENTS.md /
// opencode.json instructions), so fapony hands over the text and stays out of it.
// Not in SERVER_INSTRUCTIONS either: that reaches every MCP session of every user,
// and most of them never ran `fapony init` — it would tell them to run a command
// that does not exist.
const RULES_SNIPPET = (
  memEntry: string,
) => `## Memory: ${dirname(memEntry)}/log.<you>.jsonl (append-only)

The log is this project's shared brain — it lives in git, so anyone who clones the
repo gets every decision, bug and note with it. The filename comes from
\`git config user.name\`, one file per person, so there is nothing to merge.

Log as you work — do not wait to be asked. Nothing writes it for you:

    bun ${memEntry} kickoff <plan.md>      # start a session with this
    bun ${memEntry} add decision "what was locked, and why"
    bun ${memEntry} add bug "what is broken"
    bun ${memEntry} add note "state the next session needs"
    bun ${memEntry} close <id> "fixed in <sha>"
    bun ${memEntry} find "<text>"

Write each entry standalone — it is read months later with no chat to refer to.`;

export function initProject(targetPath: string, config?: Config): void {
  // Create target root
  mkdirSync(targetPath, { recursive: true });

  // --- .fapony/ marker ---
  const faponyDir = join(targetPath, ".fapony");
  if (existsSync(faponyDir)) {
    throw new Error(
      `${faponyDir} already exists — delete it first if you want a fresh scaffold.`,
    );
  }
  mkdirSync(faponyDir, { recursive: true });
  writeFileSync(join(faponyDir, "README"), FAPONY_README);

  // --- evidence.json (verification_report allowlist — see src/mcp/evidence.ts) ---
  const evidencePath = join(targetPath, evidenceFile(config));
  if (existsSync(evidencePath)) {
    throw new Error(`${evidencePath} already exists — not overwriting.`);
  }
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, EVIDENCE_JSON);

  // --- plan/ spec/ .memory/ — all under .fapony/ ---
  const planDirAbs = join(targetPath, planDir(config));
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
  const specDirAbs = join(targetPath, specDir(config));
  if (existsSync(specDirAbs)) {
    throw new Error(`${specDirAbs} already exists — not overwriting.`);
  }
  mkdirSync(specDirAbs, { recursive: true });

  // --- .memory/ (from template) ---
  const memEntry = memoryEntry(config); // e.g. .fapony/.memory/mem.ts
  const memoryDir = join(
    targetPath,
    memEntry.split("/").slice(0, -1).join("/"),
  );
  if (existsSync(join(targetPath, memEntry))) {
    throw new Error(
      `${join(targetPath, memEntry)} already exists — delete it first if you want a fresh copy.`,
    );
  }
  const templateDir = join(import.meta.dir, "..", "templates", "mem");
  const files = copyDir(templateDir, memoryDir);

  console.log(`scaffolded ${targetPath}/`);
  console.log(
    `  .fapony/         — project dir (plans, specs, memory, evidence)`,
  );
  console.log(`  ${planDir(config)}/    — live plan files`);
  console.log(`  ${doneDir(config)}/    — shipped plans (archive)`);
  console.log(`  ${specDir(config)}/    — spec files`);
  console.log(
    `  ${evidenceFile(config)}    — allowlist for verification_report (edit the cmds!)`,
  );
  console.log(
    `  ${relative(targetPath, memoryDir)}/ — ${files.length} files from template`,
  );
  console.log(`\nNext: add "${targetPath}" to fapony.config.json worktrees`);
  console.log(
    `\nThen paste this into your agent-rules file (CLAUDE.md / AGENTS.md / opencode.json\ninstructions) — the memory log only fills up if the rules your agent already reads\ntell it to write:\n`,
  );
  console.log(RULES_SNIPPET(memEntry));
}

export function cmdInit(args: string[]): void {
  const targetPath = args[0];
  if (!targetPath) {
    console.error("usage: fapony init <path>");
    process.exit(1);
  }
  try {
    initProject(targetPath);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
