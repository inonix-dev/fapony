# MCP Tools — Usage Guide

> For external agents (Claude Code / OpenCode / Codex / any MCP client) that want
> machine facts about their work before recording it, without adopting fapony's loop.

## Quick Start

```bash
# Start the MCP server
fapony mcp

# It reads JSON-RPC from stdin, writes to stdout (newline-delimited)
```

## The recall pipeline

```
mem_find (recall)  →  work  →  mem_add (record)  →  mem_close (when resolved)
```

One habit feeds the log: when a unit of work ends, append a mem row saying what was
decided or what broke, with the files it touched. The next session recalls it by file
before editing. Git facts + handoff conformance live behind one CLI command, not on
the MCP surface:

```bash
fapony report <run-id>   # git facts + handoff conformance + evidence + verdict, printed
```

`report` replays the whole chain for runs from the frozen ledger — no new graded runs
can be created. Facts tools were MCP tools until 2026-09-17; the schemas cost every
session of every connected client and no skill ever called them, so they moved behind
the CLI that already did the same job. The logic is unchanged.

The server exposes 3 tools in total, all higher-level and taking plain arguments —
see [README](../README.md#the-3-tools) for what each one answers:

| Tool | In one line |
|------|-------------|
| `mem_find` | The project's mem log, read-only — what was decided about these files |
| `mem_add` | Append a mem row with files[] required — decision/bug/note/next/hold |
| `mem_close` | Close a mem row by id — separate tool because a close row has no files[] |

### Two things that bite

- **`server_sha`** — `fapony report` stamps every report with the git SHA of the
  fapony code that produced it, read once at server start. An MCP server is a long-lived
  process: edit fapony without restarting the client and reports keep coming from the old
  build, with nothing else to signal it. Compare the stamp against `git log -1` in the
  fapony repo before trusting a result.
- **Evidence budget** — each allowlisted command gets `timeout_ms` (default 30s) and the
  whole report is capped at 180s. Over budget is reported as `timeout`, never as a pass.
  Verify your entries actually run the suite: a command that exits 0 without running
  anything (`bun test` in a repo whose tests live behind `bun run test`) is reported as a
  clean pass.

### 1. Git facts + conformance — via CLI, not MCP

`handoff_collect` and `handoff_check` used to be MCP tools (§§1–2 of older versions
of this doc). They left the surface with the rest of the handoff trio: the schema
rent was paid by every session and no caller used them mid-task. The engine is
unchanged and ships behind one command:

```bash
fapony report <run-id>   # git facts + handoff conformance + evidence + verdict, printed
```

**Returns:** `facts` (files, lines, commits, branch) + `checks` (has_test, has_docs,
safety) + conformance `checks[]` (name, pass, note) + `summary` (total, passed,
failed, needs_human_review).

**Conformance checks performed:**
| Check | Passes when |
|-------|-------------|
| `has_handoff_block` | handoff contains `## HANDOFF` |
| `claimed_matches_commits` | claimed commit exists in commits list |
| `uncertain_not_empty` | no uncertainty flagged |
| `not_done_not_empty` | no incomplete items |
| `checks_declared` | checks field present |
| `facts_cross_referenced` | commits match git facts |

### 2. `mem_find` — Recall what was decided

```json
{
  "method": "tools/call",
  "params": {
    "name": "mem_find",
    "arguments": {
      "worktree": "/path/to/repo",
      "files": ["src/hook.ts"],
      "text": "kickoff",
      "kind": ["bug"],
      "since": "2026-09-01",
      "limit": 10
    }
  }
}
```

**Params** (only `worktree` is required — absolute path, `git rev-parse --show-toplevel`):
- `files[]` — repo-relative paths, matched against each row's stored `files[]`
  first, falling back to a substring of `text`/`spec`/`ref` for rows written
  before `--files` existed. In a monorepo pass the app directory to read its log.
- `text` — substring filter, case-insensitive.
- `key` — exact problem-identity match; a miss returns `knownKeys` (every
  distinct key in the log) instead of a silent empty.
- `kind` — filter by kind (`decision`/`note`/`bug`/`close`/…). Omit = every kind,
  there is no default filter.
- `since` — ISO date, only rows at or after this time.
- `limit` — max rows returned (default 20); `total` still counts all matches.

**Returns** `{rows, total, filesFound, skipped, memDir}` — plus `knownKeys` when
a `key` query misses. `memDir:null` means the project has no mem log at all —
not "nothing matched".

### 3. `mem_add` / `mem_close` — Record what happened

```json
{
  "method": "tools/call",
  "params": {
    "name": "mem_add",
    "arguments": {
      "worktree": "/path/to/repo",
      "kind": "bug",
      "text": "hook-stop compared timestamps as strings; pulling the fix into one commit",
      "files": ["src/hook.ts"]
    }
  }
}
```

**Kinds** (required — what shape of record this is):
- `decision` — decided something the next session would wonder about
- `bug` — found something broken
- `note` — end-of-chunk status the next session needs
- `next` / `hold` — bookkeeping, owned by the mem tooling

**`files[]` is required and rejected when empty** — a row that names no file is
unfindable when you next touch that file, so the server refuses it. Write `text`
standalone: it is read months later with no access to this conversation.

Two more rejections to know before you script against this:
- `hold` requires a `spec` (`spec: <path/to/SPEC.md>`) — without one the row can
  never be resolved by rotate, so the server refuses it.
- `next` / `hold` are capped (15 / 10 open rows). Over the cap the server errors
  until you close an old one; `MEM_FORCE=1` bypasses the cap the way the CLI does.

Close the row when the pain is resolved:

```json
{
  "method": "tools/call",
  "params": {
    "name": "mem_close",
    "arguments": {
      "worktree": "/path/to/repo",
      "id": "mubjyf0h",
      "text": "fixed in <sha>"
    }
  }
}
```

`mem_close` is a separate tool, not `kind:"close"`, because a close row carries no
`files[]` — sharing `mem_add`'s schema would make required fields depend on another
field's value.

## Example: Claude Code Adapter

```bash
# In your Claude Code session, after writing code:

# Step 1: Recall — what was decided about these files?
echo '{"method":"tools/call","params":{"name":"mem_find","arguments":{"worktree":"'"$PWD"'","files":["src/you/touched.ts"]}}}' | fapony mcp

# Step 2: Facts + conformance — one CLI call, no MCP schema involved
fapony report <run-id>

# Step 3: If the work taught something, record it
echo '{"method":"tools/call","params":{"name":"mem_add","arguments":{"worktree":"'"$PWD"'","kind":"bug","text":"what broke and why","files":["src/you/touched.ts"]}}}' | fapony mcp
```

## Example: Python Adapter

```python
import json
import subprocess

class FaponyMem:
    def __init__(self):
        self.proc = subprocess.Popen(
            ["fapony", "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )

    def _call(self, method, params=None):
        msg = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def recall(self, worktree, files):
        r = self._call("tools/call", {
            "name": "mem_find",
            "arguments": {"worktree": worktree, "files": files}
        })
        return json.loads(r["result"]["content"][0]["text"])

    def add_row(self, worktree, kind, text, files):
        r = self._call("tools/call", {"name": "mem_add", "arguments": {
            "worktree": worktree,
            "kind": kind,
            "text": text,
            "files": files,
        }})
        return json.loads(r["result"]["content"][0]["text"])

    def close_row(self, worktree, row_id, text):
        r = self._call("tools/call", {"name": "mem_close", "arguments": {
            "worktree": worktree,
            "id": row_id,
            "text": text,
        }})
        return json.loads(r["result"]["content"][0]["text"])

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()

# Usage
hc = FaponyMem()
recall = hc.recall("/path/to/repo", ["src/touched.ts"])
# facts + conformance run on the CLI: `fapony report <run-id>`
row = hc.add_row("/path/to/repo", "bug", "what broke and why", ["src/touched.ts"])
hc.close_row("/path/to/repo", row["id"], "fixed in <sha>")
hc.close()
```

## Running the Server

```bash
# Via CLI
fapony mcp

# Via MCP config (e.g., Claude Desktop)
{
  "mcpServers": {
    "fapony": {
      "command": "fapony",
      "args": ["mcp"]
    }
  }
}
```

## Safety Rules

1. All git commands go through `assertSafe()` — dangerous patterns blocked
2. No source/diff/plan content in tool responses — only facts + mem rows
3. Provenance: fapony-verified facts are `verified`, agent claims stay `unverified` until cross-referenced
4. Schema is backward-compatible — new fields added, old fields never changed
