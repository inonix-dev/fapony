// src/mcp/tools/index.ts — barrel + TOOLS array

import { VERDICT_GRADES } from "../../parse.js";
import { REASON_CODES, REGIME_CODES } from "../types.js";

export { toolProjectHealthContext } from "./context.js";
export { toolMemFind } from "./mem.js";
export { toolPlanList } from "./plans.js";
export { toolFaponyStats } from "./stats.js";
export { toolPassiveUsage } from "./usage.js";
export { toolVerdictSubmit } from "./verdict.js";

// --- Tool definitions ---

export const TOOLS = [
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
            "The client session id — Claude Code/Codex: the transcript .jsonl path; " +
            "OpenCode/ZCode: the session id. It is what attributes this verdict to a model; " +
            "without it fapony infers the model from whichever session is running, which is a " +
            "guess. Send it whenever the client exposes it. Cannot find it → omit, never invent one.",
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
      "Query passive usage across every coding client on this machine — " +
      "OpenCode, Claude Code, Codex, and ZCode — on one ruler: token counts, " +
      "cost, and breakdown by model. No client's own session log can see " +
      "another's, so this is the only way to compare them. Filter by " +
      "worktree and time range.",
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
    name: "project_health_context",
    description:
      "Known-patterns block for files[]: recurring fail reasons, escalated runs, " +
      "and round-1-pass shapes from real run history. Worth a call when you are " +
      "about to touch a file that has history — a long-lived file, one you have " +
      "not seen before, or one a previous attempt already failed on. The unit is " +
      "touched files, not a plan; a bug fix with no plan file still qualifies. " +
      "Returns nothing when there is no history (most files); short plain-text " +
      "block, framed as watch-fors, not constraints.",
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
    name: "mem_find",
    description:
      "Search the project's mem log (.fapony/.memory/log*.jsonl — decisions, " +
      "bugs, notes, and bookkeeping kinds alike; NO default kind filter). " +
      "Read-only. Answer 'what was ever decided about this file?' in one call " +
      "BEFORE editing: pass files[] (repo-relative) to match rows mentioning " +
      "them. mem never stored files[], so match is substring over text/spec/ref " +
      "— a row that never names the file cannot be found (limit of the data, " +
      "not the query). In a monorepo only the log of the app guessed from the " +
      "worktree name is read; memDir in the result shows which one. Returns " +
      "{rows, total, filesFound, skipped, memDir}: total is the match count " +
      "before limit, memDir:null means no mem at all (not 'nothing matched').",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktree: {
          type: "string",
          description:
            "Absolute path (git rev-parse --show-toplevel) — required; " +
            "scope of the mem log to read",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Repo-relative paths — match rows whose text/spec/ref mentions them (substring)",
        },
        text: {
          type: "string",
          description: "Substring, case-insensitive",
        },
        kind: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by kind (decision/note/bug/close/…). Omit = every kind — " +
            "no default filter",
        },
        since: {
          type: "string",
          description: "ISO date — only rows at or after this time",
        },
        limit: {
          type: "number",
          description:
            "Max rows returned (default 20) — total still counts all matches",
        },
      },
      required: ["worktree"],
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
