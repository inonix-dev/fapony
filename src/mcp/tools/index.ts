// src/mcp/tools/index.ts — barrel + TOOLS array

import { VERDICT_GRADES } from "../../parse.js";
import { REASON_CODES, REGIME_CODES } from "../types.js";

export { extractMultiField, toolHandoffCheck } from "./check.js";
export { toolHandoffCollect } from "./collect.js";
export { toolProjectHealthContext } from "./context.js";
export { toolPlanList } from "./plans.js";
export { toolVerificationReport } from "./report.js";
export { toolFaponyStats } from "./stats.js";
export { toolPassiveUsage } from "./usage.js";
export { toolVerdictSubmit } from "./verdict.js";

// --- Tool definitions ---

export const TOOLS = [
  {
    name: "handoff_collect",
    description:
      "Collect machine facts from git: diff stat, commits, branch. " +
      "Returns verified facts (fapony runs git directly, not trusting agent claims). " +
      "If base_sha/head_sha are omitted, auto-detects from recent commits (HEAD~1..HEAD).",
    inputSchema: {
      type: "object" as const,
      properties: {
        base_sha: {
          type: "string",
          description:
            "Git base SHA for diff range. Defaults to HEAD~1 if omitted.",
        },
        head_sha: {
          type: "string",
          description:
            "Git head SHA for diff range. Defaults to HEAD if omitted.",
        },
        worktree: {
          type: "string",
          description: "Absolute path to git worktree",
        },
      },
      required: ["worktree"],
    },
  },
  {
    name: "handoff_check",
    description:
      "Verify handoff conformance: check that executor's handoff block has " +
      "required fields, no unresolved uncertainty, and facts cross-reference. " +
      "Set auto_generate to true to auto-fill claimed/commits from git facts, " +
      "but uncertain/not_done/checks must still come from the agent. " +
      "When worktree is provided, includes blast_radius of changed files.",
    inputSchema: {
      type: "object" as const,
      properties: {
        handoff: {
          type: "string",
          description:
            "Raw handoff text (must contain ## HANDOFF block). " +
            "If auto_generate is true, this is optional and claimed/commits will be filled from facts.",
        },
        facts: {
          type: "object",
          description:
            "Optional facts from handoff_collect for cross-reference",
        },
        auto_generate: {
          type: "boolean",
          description:
            "If true, auto-fill claimed/commits from git facts. " +
            "uncertain/not_done/checks must still be provided by the agent.",
        },
        uncertain: {
          type: "string",
          description:
            "Agent-reported uncertainty. Use 'none' if no uncertainty. " +
            "Required when auto_generate is true.",
        },
        not_done: {
          type: "string",
          description:
            "Agent-reported incomplete items. Use 'none' if nothing pending. " +
            "Required when auto_generate is true.",
        },
        checks: {
          type: "string",
          description:
            "Agent-reported checks performed. " +
            "Required when auto_generate is true.",
        },
        plan_ref: {
          type: "string",
          description: "Optional plan file reference",
        },
        worktree: {
          type: "string",
          description:
            "Absolute path to git worktree. When provided with facts.files[], " +
            "computes blast_radius (dependents + tested flag per changed file).",
        },
      },
      required: [],
    },
  },
  {
    name: "verdict_submit",
    description:
      "Grade a finished unit of work. " +
      "WHEN: every unit that ends, including work that went right the first " +
      "time — this is a grade on the work, not a confession, and a model's " +
      "record is only worth the number of graded units behind it. " +
      "If a first attempt was wrong, submit 'fail' the moment you realize it, " +
      "then a pass-family verdict once the fix is verified. " +
      "Never leave a run open — one stuck at running/fixing " +
      "absorbs later unrelated verdicts for that worktree. " +
      "Without run_id, binds to the latest still-open run for the same " +
      "worktree+plan (round keeps counting toward review.maxRounds); " +
      "creates a new run entry only when none is open.",
    inputSchema: {
      type: "object" as const,
      properties: {
        run_id: {
          type: "number",
          description:
            "Optional run ID from fapony. If omitted, a new run is created automatically.",
        },
        verdict: {
          type: "string",
          enum: [...VERDICT_GRADES],
          description: "Verdict grade",
        },
        reason_code: {
          type: "string",
          enum: [...REASON_CODES],
          description:
            "Standardized failure reason code. Use 'none' for clean passes (not 'other').",
        },
        regime: {
          type: "string",
          enum: [...REGIME_CODES],
          description:
            "Task shape: code=new feature/refactor, fix=debugging an existing defect, " +
            "review=reviewing someone else's work/diff, plan=producing a plan or spec, " +
            "inquiry=asking questions without editing files, test=writing or editing tests as primary work",
        },
        note: {
          type: "string",
          description: "Optional note (required when reason_code = 'other')",
        },
        worktree: {
          type: "string",
          description:
            "Absolute path of the repo/worktree (git rev-parse --show-toplevel), used when run_id is omitted. " +
            "Send it: every fapony query scopes by absolute path, so a bare repo name lands in a bucket no " +
            'query reads, and omitting it files the verdict under "mcp-external" instead of the project. ' +
            "Neither case errors.",
        },
        plan: {
          type: "string",
          description:
            "Optional plan file path for a new run (used only when run_id is omitted)",
        },
        session_id: {
          type: "string",
          description:
            "Optional client session id (OpenCode/ZCode session id, or Claude Code/Codex .jsonl path). " +
            "Used to resolve model attribution when no spawn events exist in the gate window.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Repo-relative paths of the files this work unit touched. Technically " +
            "optional, but always send them: this is the only input to per-file " +
            "risk history — a verdict with no files[] teaches the next session " +
            "nothing about where the risk was.",
        },
      },
      required: ["verdict", "reason_code", "regime"],
    },
  },
  {
    name: "fapony_stats",
    description:
      "Query accumulated run statistics: pass/stall rates, quality scores, " +
      "breakdown by model/grade/worktree. Returns StatsData shape. " +
      "With group_by='reason_code'|'plan'|'file', returns top-N rows for that " +
      "grouping (recurring failure signatures / per-plan totals / per-file " +
      "gate-vs-fail counts) instead of the full shape.",
    inputSchema: {
      type: "object" as const,
      properties: {
        json: {
          type: "boolean",
          description:
            "If true, return raw JSON StatsData. If false (default), return human-readable text.",
        },
        group_by: {
          type: "string",
          enum: ["reason_code", "plan", "file"],
          description:
            "Optional grouping: top-N reason_code counts, per-plan totals, or " +
            "per-file risk (graded touches vs fails) from real gate events.",
        },
        top: {
          type: "number",
          description: "Max rows returned with group_by (default 10).",
        },
        worktree: {
          type: "string",
          description:
            "Scope a group_by query to one worktree path (absolute).",
        },
      },
      required: [],
    },
  },
  {
    name: "fapony_usage",
    description:
      "Query passive usage from opencode sessions: token counts, cost, " +
      "and breakdown by model. Filter by worktree and time range.",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktree: {
          type: "string",
          description: "Filter by worktree path (absolute)",
        },
        since: {
          type: "number",
          description:
            "Unix timestamp — include sessions created at or after this time",
        },
        until: {
          type: "number",
          description:
            "Unix timestamp — include sessions created at or before this time",
        },
        detail: {
          type: "boolean",
          description:
            "If true, include tool-call breakdown + step counts per session " +
            "(activity signal, not quality). Default false keeps output compact.",
        },
        json: {
          type: "boolean",
          description:
            "If true, return raw JSON PassiveUsageResult. If false (default), return human-readable text.",
        },
      },
      required: [],
    },
  },
  {
    name: "verification_report",
    description:
      "Generate a complete verification report: git facts, handoff conformance, " +
      "evidence (test/typecheck/lint), verdict, duration, and rounds. " +
      "Call once after working to get a full picture. " +
      "Supports text (human-readable) and JSON (machine-readable) formats.",
    inputSchema: {
      type: "object" as const,
      properties: {
        run_id: {
          type: "number",
          description:
            "Run ID from fapony. Resolves worktree, events, and verdict automatically.",
        },
        worktree: {
          type: "string",
          description:
            "Absolute path to git worktree. Used when run_id is not available.",
        },
        base_sha: {
          type: "string",
          description: "Git base SHA for diff range. Defaults to HEAD~1.",
        },
        head_sha: {
          type: "string",
          description: "Git head SHA for diff range. Defaults to HEAD.",
        },
        handoff: {
          type: "string",
          description:
            "Agent's handoff text. If omitted with run_id, reads from events.",
        },
        uncertain: {
          type: "string",
          description:
            "Agent-reported uncertainty for the handoff check. If omitted, " +
            "reported-ness is derived from whether the handoff text contains the field.",
        },
        not_done: {
          type: "string",
          description:
            "Agent-reported incomplete items for the handoff check. If omitted, " +
            "reported-ness is derived from whether the handoff text contains the field.",
        },
        checks: {
          type: "string",
          description:
            "Agent-reported checks for the handoff check. If omitted, " +
            "reported-ness is derived from whether the handoff text contains the field.",
        },
        evidence_commands: {
          type: "array",
          items: { type: "string" },
          description:
            "Additional commands to check (agent-proposed, gets unverified provenance).",
        },
        format: {
          type: "string",
          enum: ["text", "json"],
          description: "Output format. Default: text.",
        },
      },
      required: [],
    },
  },
  {
    name: "project_health_context",
    description:
      "Call this BEFORE editing files: known-patterns context for the files " +
      "you are about to touch — recurring fail reasons, escalated runs, and " +
      "round-1-pass shapes from real run history. Pass files[] (the unit is " +
      "touched files, not a plan; a bug fix with no plan file still qualifies). " +
      "Short plain-text block (framed as watch-fors, not constraints).",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktree: {
          type: "string",
          description:
            "Scope to one worktree path (absolute). Global across worktrees when omitted.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter findings to only those related to these files. " +
            "Matches against stored gate event files and note text.",
        },
      },
      required: [],
    },
  },
  {
    name: "plan_list",
    description:
      "List pending plan files grouped by state — active / blocked / " +
      "untouched / superseded / trackers — each with title and last-run " +
      "status joined from fapony run history, plus a count of archived " +
      "ones. Not a raw directory listing: answers 'what is left, what is " +
      "waiting on what, what should come next'. State comes from optional " +
      "plan frontmatter (kind: tracker | status: active|blocked|superseded " +
      "| blocked_by: | blocks: | superseded_by:); a plan without " +
      "frontmatter is grouped by run history alone (attempted = active, " +
      "never attempted = untouched). Within active, whatever unblocks the " +
      "most other plans is listed first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktree: {
          type: "string",
          description: "Absolute path to the project's git worktree",
        },
        format: {
          type: "string",
          enum: ["json", "markdown"],
          description:
            "'markdown' renders the groups as a checklist to paste or read; " +
            "default 'json'.",
        },
      },
      required: ["worktree"],
    },
  },
];
