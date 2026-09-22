// test/hook/fixtures.ts — shared test fixtures for hook tests.

export const base = {
  stopHookActive: false,
  worktree: "/repo",
  commits: 2,
  memLastTs: "2026-09-15T00:00:00Z",
  since: "2026-09-20T00:00:00Z",
};

// https://cursor.com/docs/agent/hooks — common schema + the stop event
export const claudePayload = {
  cwd: "/repo",
  transcript_path: "/repo/.claude/t.jsonl",
  stop_hook_active: false,
};

export const cursorPayload = {
  conversation_id: "conv-1",
  generation_id: "gen-1",
  model: "composer-1",
  model_id: "gpt-5",
  hook_event_name: "stop",
  cursor_version: "1.7.2",
  workspace_roots: ["/repo"],
  user_email: null,
  transcript_path: null,
  status: "completed",
  loop_count: 0,
};

// https://learn.chatgpt.com/docs/hooks — Codex Stop payload
export const codexPayload = {
  cwd: "/repo",
  session_id: "sess-codex-1",
  transcript_path: "/repo/.codex/transcripts/sess-codex-1.jsonl",
  stop_hook_active: false,
  hook_event_name: "Stop",
  model: "gpt-5",
  permission_mode: "default",
};

export const REPO_SPECIFIC_CMDS =
  /bun fapony\.ts|npm (run test|test|exec)|pnpm test|yarn test/;
