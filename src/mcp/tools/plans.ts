// src/mcp/tools/plans.ts — plan_list tool
//
// Answers "what's pending, what's blocked on what, and what should come
// next" — not a directory listing (an agent can `ls` on its own for that).
// Two joins give it that: filesystem plan files × real run history from
// `runs`/`events`, and the plan's own frontmatter × the plans it points at.
//
// The frontmatter is deliberately tiny (4 keys) because everything else is
// derivable: "never touched" comes from run history, ordering comes from the
// blocks/blocked_by edges. A plan with no frontmatter at all still lands in a
// sensible group, so an existing repo gets value before anyone annotates it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  doneDir,
  type Event,
  loadConfig,
  openDb,
  planDir,
  type Run,
} from "../../db/index.js";
import { getLastVerdictByPlan, resolveMaxRounds } from "../../stats/index.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";

type Front = {
  kind?: string;
  status?: string;
  blocked_by?: string;
  blocks: string[];
  superseded_by?: string;
  spec?: string;
  priority?: string;
};

type Entry = {
  file: string;
  title: string;
  runs: number;
  last: string;
  escalated: boolean;
  progress?: string;
  blocked_by?: string;
  blocks?: string[];
  superseded_by?: string;
  spec?: string;
  priority?: string;
};

const EMPTY: Front = { blocks: [] };

/** Frontmatter without a YAML dependency: flat `key: value` lines only. */
export function parseFront(text: string): Front {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { blocks: [] };
  const front: Front = { blocks: [] };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    // A trailing `# why` comment is prose for the human, not part of the value.
    const value = kv[2].replace(/\s+#.*$/, "").trim();
    if (!value) continue;
    if (kv[1] === "blocks") {
      front.blocks = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (kv[1] === "kind") front.kind = value;
    else if (kv[1] === "spec") front.spec = value;
    else if (kv[1] === "status") front.status = value;
    else if (kv[1] === "blocked_by") front.blocked_by = value;
    else if (kv[1] === "superseded_by") front.superseded_by = value;
    else if (kv[1] === "priority") front.priority = value;
  }
  return front;
}

/**
 * Checkbox tally of the plan's summary block — the first `##` section after
 * the title, whatever it is called. Anchoring on position instead of on the
 * literal "TL;DR" keeps this working for plans written in any language; the
 * deeper sections are skipped on purpose, because a step list halfway down a
 * 140KB plan is detail, not status.
 */
function progressOf(text: string): string | undefined {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  const start = body.search(/^##\s+/m);
  if (start < 0) return undefined;
  const rest = body.slice(start);
  const next = rest.slice(3).search(/^##\s+/m);
  const block = next < 0 ? rest : rest.slice(0, next + 3);
  const total = block.match(/^\s*[-*]\s+\[[ xX]\]/gm)?.length ?? 0;
  if (!total) return undefined;
  const done = block.match(/^\s*[-*]\s+\[[xX]\]/gm)?.length ?? 0;
  return `${done}/${total}`;
}

function read(path: string): {
  title: string;
  front: Front;
  progress?: string;
} {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { title: "(unreadable)", front: EMPTY };
  }
  const m = /^#\s+(.+)$/m.exec(text);
  return {
    title: m ? m[1].trim() : "(no title)",
    front: parseFront(text),
    progress: progressOf(text),
  };
}

type Groups = {
  active: Entry[];
  blocked: Entry[];
  untouched: Entry[];
  superseded: Entry[];
  trackers: Entry[];
  done: number;
};

function line(e: Entry): string {
  const bits: string[] = [e.progress ?? e.last];
  if (e.blocks?.length) bits.push(`unblocks ${e.blocks.join(", ")}`);
  if (e.blocked_by) bits.push(`waiting: ${e.blocked_by}`);
  if (e.superseded_by) bits.push(`replaced by ${e.superseded_by}`);
  if (e.escalated) bits.push("escalated");
  const box = e.progress?.match(/^(\d+)\/\1$/) ? "x" : " ";
  return `- [${box}] ${e.file.replace(/\.md$/, "")} — ${bits.join(" · ")}`;
}

/**
 * The hand-maintained master checklist, generated instead. Everything here
 * already lives in the plans themselves (frontmatter edges + summary
 * checkboxes), so a rendered view can never drift out of date the way a
 * MASTER.md does.
 */
export function renderPlanList(g: Groups): string {
  const out: string[] = [];
  const section = (name: string, list: Entry[]) => {
    if (!list.length) return;
    out.push(`## ${name} (${list.length})`);
    for (const e of list) out.push(line(e));
    out.push("");
  };
  section("active — in order", g.active);
  section("blocked", g.blocked);
  section("untouched", g.untouched);
  section("superseded — archive these", g.superseded);
  section("trackers — not backlog", g.trackers);
  out.push(`done: ${g.done} archived`);
  return out.join("\n");
}

export function toolPlanList(args: Record<string, unknown>): ToolResult {
  const worktree = typeof args.worktree === "string" ? args.worktree : "";
  if (!worktree) return errorResult("worktree is required (absolute path)");
  const markdown = args.format === "markdown";

  // Path layout belongs to the worktree being listed, not to wherever the MCP
  // server happened to start — a repo that keeps plans in apps/<app>/plan says
  // so in its own fapony.config.json. Fall back to the server-global config
  // (FAPONY_CONFIG or cwd) when the worktree has none.
  const localConfig = join(worktree, "fapony.config.json");
  const config = existsSync(localConfig)
    ? loadConfig(localConfig)
    : loadConfig();
  const dir = join(worktree, planDir(config));
  // Archive lives beside plan/, so a plan keeps its depth (and its relative
  // links) when it is archived. Repos from before that layout keep theirs:
  // fall back to plan/done/ rather than silently reporting 0 archived.
  const configured = join(worktree, doneDir(config));
  const archive = existsSync(configured) ? configured : join(dir, "done");
  const empty = {
    active: [],
    blocked: [],
    untouched: [],
    superseded: [],
    trackers: [],
  };
  if (!existsSync(dir)) {
    return jsonResult({ ...empty, done: 0, error: `no plan dir at ${dir}` });
  }

  const pendingFiles = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const doneCount = existsSync(archive)
    ? readdirSync(archive).filter((f) => f.endsWith(".md")).length
    : 0;

  const db = openDb();
  const runs = db.prepare("SELECT * FROM runs ORDER BY id").all() as Run[];
  const events = db
    .prepare("SELECT * FROM events ORDER BY run_id, id")
    .all() as Event[];
  const byPlan = getLastVerdictByPlan(runs, events, resolveMaxRounds());

  const active: Entry[] = [];
  const blocked: Entry[] = [];
  const untouched: Entry[] = [];
  const superseded: Entry[] = [];
  const trackers: Entry[] = [];

  for (const file of pendingFiles) {
    const { title, front, progress } = read(join(dir, file));
    // Runs record whatever plan string the caller passed (often a relative
    // or absolute path) — match by filename suffix, not exact equality.
    const match = byPlan.find((p) => p.plan.endsWith(file));
    const entry: Entry = {
      file,
      title,
      runs: match?.runs ?? 0,
      last: match
        ? match.lastReasonCode
          ? `${match.lastVerdict}(${match.lastReasonCode})`
          : match.lastVerdict
        : "never attempted",
      escalated: match?.escalated ?? false,
    };
    if (progress) entry.progress = progress;
    if (front.spec) entry.spec = front.spec;
    if (front.blocked_by) entry.blocked_by = front.blocked_by;
    if (front.blocks.length) entry.blocks = front.blocks;
    if (front.superseded_by) entry.superseded_by = front.superseded_by;
    if (front.priority) entry.priority = front.priority;

    // A tracker is never a unit of work, so it never "finishes" and must not
    // sit in the backlog shaming everyone — that's why done/ never moved.
    if (front.kind === "tracker") trackers.push(entry);
    else if (front.status === "superseded") superseded.push(entry);
    else if (front.status === "blocked" || front.blocked_by)
      blocked.push(entry);
    else if (front.status === "active" || entry.runs > 0) active.push(entry);
    else untouched.push(entry);
  }

  // Ordering: priority: high first → unblocks the most → alphabetical
  active.sort(
    (a, b) =>
      (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0) ||
      (b.blocks?.length ?? 0) - (a.blocks?.length ?? 0) ||
      a.file.localeCompare(b.file),
  );

  const groups: Groups = {
    active,
    blocked,
    untouched,
    superseded,
    trackers,
    done: doneCount,
  };
  return markdown
    ? { content: [{ type: "text", text: renderPlanList(groups) }] }
    : jsonResult(groups);
}
