export type RunStatus =
  | "running"
  | "awaiting_review"
  | "fixing"
  | "passed"
  | "stopped"
  | "stalled";

export interface Run {
  id: number;
  worktree: string;
  plan: string | null;
  mem_id: string | null;
  status: RunStatus;
  base_sha: string;
  round: number;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  run_id: number;
  ts: string;
  kind: string;
  data: string | null;
}

export interface Config {
  worktrees: Record<string, string>;
  review: {
    maxRounds: number;
  };
  memory: {
    claim: string[];
    close: string[];
    add: string[];
    kickoff?: string[];
  } | null;
  // opt-in only — omit or leave null to keep everything local. See TELEMETRY.md
  // for the exact payload shape (KPI numbers + event kind/timestamp, no
  // plan/commit/gate-note content, ever).
  telemetry?: {
    enabled: boolean;
    endpoint: string;
    /** Self-reported metadata — advisory, not machine-observed. */
    metadata?: {
      task_category?: string;
      stack?: string;
      notes?: string;
    };
  } | null;
  // --- Flexible paths / limits (all optional, defaults = old hardcodes) ---
  paths?: {
    // state dir override (default: $XDG_CONFIG_HOME/fapony or ~/.config/fapony).
    // $FAPONY_STATE_DIR env wins over this when set.
    stateDir?: string;
    // plan/spec/memory layout inside each worktree (relative to worktree root).
    planDir?: string;
    specDir?: string;
    doneDir?: string;
    memoryEntry?: string;
    evidenceFile?: string;
  } | null;
  safety?: {
    // regex sources tested against the joined argv; default = the 4 git patterns.
    deny?: string[];
  } | null;
  usageWeb?: {
    port?: number;
    hostname?: string;
    ownerName?: string;
  } | null;
}

export interface RolePricing {
  inputPer1k: number;
  outputPer1k: number;
}
