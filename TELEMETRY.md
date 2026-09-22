# Telemetry

Off by default. Nothing leaves your machine unless you turn it on.

## Schema version

Payloads include `schema_version` (currently `4`). Receivers must:
- Accept payloads with a version they recognize
- Reject payloads with an unknown version (forward-incompatible by design)
- Tolerate unknown fields in the payload (additive-only changes)

## What gets sent (only when you run `fapony telemetry send`)

The payload contains **aggregate machine-observed facts** — never raw rows,
never content.

### `machine` (ground truth, computed by fapony)

| Field | Type | Description |
|-------|------|-------------|
| `total_runs` | number | Total runs in DB at send-time |
| `by_status` | `{passed: 5, ...}` | Status distribution |
| `pass_rate` | number | passed / terminal (0.0–1.0) |
| `stall_rate` | number | stalled / terminal |
| `avg_rounds` | number | Avg rounds for passed runs |
| `avg_minutes` | number | Avg wall-clock time for passed runs |
| `by_model` | `[{model, gate_count, avg_quality}]` | Per-executor-model breakdown |
| `by_grade` | `[{grade, count}]` | Per-verdict-grade breakdown |
| `by_worktree` | `[{worktree, runs, passed, stalled}]` | Per-worktree (paths redacted to basename) |
| `derived` | `{tool_call_counts}`? | Activity signals (absent when empty) |

**`derived` sub-fields:**

| Field | Type | Description |
|-------|------|-------------|
| `tool_call_counts` | `{grep: 3400, edit: 2100, ...}` | Tool-call counts from OpenCode sessions **scoped to this DB's fapony worktrees** (run worktree keys resolved via `config.worktrees`; unresolvable keys contribute nothing — never global). Activity signal, not quality |

Scope and basis rules:

- `tool_call_counts` covers only OpenCode projects whose worktree path matches a
  resolved fapony worktree — sessions from unrelated projects are never read.
  Only tool **names** + counts leave the machine; tool input/output is never
  selected.
- No cost field leaves the machine at all: the declared-cost line (spawn
  events, static pricing, ES/CPQ) was removed in schema v4 (current) — nothing wrote
  spawn events any more, so every one of those numbers was empty.

### `self_reported` (advisory, user-set in config)

| Field | Type | Description |
|-------|------|-------------|
| `task_category` | string? | "feature", "bugfix", "refactor" — user-set |
| `stack` | string? | "bun", "node", "deno" — user-set |
| `notes` | string? | Free-text from user |

Self-reported fields are **not computed by fapony** and may be inaccurate.
Receivers should treat them as advisory, not ground truth.

## What never gets sent

- `events.data` — plan text, commit hashes+messages, gate review notes,
  `NEXT-PROMPT`/`FILE_DONE` planner output
- Anything from the worktree itself (source code, diffs, file contents)
- `mem_id` (may correlate with your product's memory system)
- Free-text content from events or runs (only structural aggregates)
- Full worktree paths (redacted to basename)

## Retention, deletion, and correction

- **Retention on sender:** Payload is a snapshot at send-time. No history is
  kept beyond what SQLite stores. Delete local runs/events anytime — the
  payload is already extracted.
- **Retention on receiver (recommended):** 90 days raw payloads, then
  aggregate-only. Never keep raw payloads indefinitely.
- **Deletion:** Sender can delete local data anytime. No "correction" exists
  on the wire — receivers should treat payloads as immutable facts.
- **Correction:** If sender needs to retract a data point, they stop sending.
  No negative/delta payloads.

## Turning it on

Off unless both are set in `fapony.config.json`:

```json
"telemetry": {
  "enabled": true,
  "endpoint": "https://your-server/ingest",
  "metadata": {
    "task_category": "feature",
    "stack": "bun",
    "notes": "optional free-text"
  }
}
```

`metadata` is optional. Omit it entirely to send only machine-observed data.

`fapony telemetry send` is a manual command — nothing runs automatically in
the background or as part of any other `fapony` command. There is no default
endpoint; you point it at a server you control.

`endpoint` just needs to accept a `POST` with a JSON body (see
`TelemetryPayload` in [src/telemetry.ts](src/telemetry.ts)) — no fapony-side
server exists yet, this only builds and sends the payload.

Run `fapony telemetry show` any time to print the exact JSON payload before
deciding whether to send it — it's the same code path `send` uses.
