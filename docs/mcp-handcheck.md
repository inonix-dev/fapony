# MCP Handcheck Protocol — Usage Guide

> For external agents (Claude Code / OpenCode / Codex / any MCP client) that want
> machine facts about their work before submitting, without adopting fapony's loop.

## Quick Start

```bash
# Start the MCP server
fapony mcp

# It reads JSON-RPC from stdin, writes to stdout (newline-delimited)
```

## The verification pipeline

```
git facts  →  conformance  →  verdict_submit
                                     ↓
                               store verdict
```

The first two steps are CLI-only: `fapony report <run-id>` runs the whole chain —
git facts, handoff conformance, evidence, verdict — and prints it. They were MCP
tools until 2026-09-17; the schemas cost every session of every connected client
and no skill ever called them, so they moved behind the CLI that already did the
same job. The logic is unchanged.

The server exposes 3 tools in total, all higher-level and taking plain arguments —
see [README](../README.md#the-3-tools) for what each one answers:

| Tool | In one line |
|------|-------------|
| `verdict_submit` | Grade a finished unit of work — the one habit the ledger needs |
| `mem_find` | The project's mem log, read-only — what was decided about these files |
| `mem_add` | Append a mem row with files[] required — decision/bug/note/next/hold |

### Two things that bite

- **`server_sha`** — `verification_report` stamps every report with the git SHA of the
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

### 2. `verdict_submit` — Record the verdict

```json
{
  "method": "tools/call",
  "params": {
    "name": "verdict_submit",
    "arguments": {
      "run_id": 42,
      "verdict": "pass",
      "reason_code": "missing_test",
      "regime": "code",
      "note": "needs integration test"
    }
  }
}
```

**Regimes** (required — the task shape the grade applies to):
- `code` — new feature or refactor
- `fix` — debugging an existing defect
- `review` — reviewing someone else's work or diff
- `plan` — producing a plan or spec, not code
- `inquiry` — asking questions without editing files
- `test` — writing or editing tests as primary work

**Reason codes:**
- `missing_test` — claims test pass but no new test covers the change
- `scope_mismatch` — diff exceeds agreed plan
- `unsafe_command` — dangerous command detected
- `spec_gap` — spec doesn't cover edge case found
- `timeout` — agent ran too long and had to be cut
- `blocked` — stuck on external dependency/env, not the task itself
- `incomplete` — ended with work still unfinished
- `none` — clean pass, nothing to report (use this instead of `other` for clean passes)
- `other` — requires `note` field

## Example: Claude Code Adapter

```bash
# In your Claude Code session, after writing code:

# Step 1: Recall — what was decided about these files?
echo '{"method":"tools/call","params":{"name":"mem_find","arguments":{"worktree":"'"$PWD"'","files":["src/you/touched.ts"]}}}' | fapony mcp

# Step 2: Facts + conformance — one CLI call, no MCP schema involved
fapony report <run-id>

# Step 3: If the work held up, submit verdict
echo '{"method":"tools/call","params":{"name":"verdict_submit","arguments":{"run_id":'$RUN_ID',"verdict":"pass","reason_code":"none","regime":"code"}}}' | fapony mcp
```

## Example: Python Adapter

```python
import json
import subprocess

class FaponyHandcheck:
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

    def submit_verdict(self, run_id, verdict, reason_code, regime, note=None):
        args = {
            "run_id": run_id,
            "verdict": verdict,
            "reason_code": reason_code,
            "regime": regime,
        }
        if note:
            args["note"] = note
        r = self._call("tools/call", {"name": "verdict_submit", "arguments": args})
        return json.loads(r["result"]["content"][0]["text"])
    
    def close(self):
        self.proc.stdin.close()
        self.proc.wait()

# Usage
hc = FaponyHandcheck()
recall = hc.recall("/path/to/repo", ["src/touched.ts"])
# facts + conformance run on the CLI: `fapony report <run-id>`
result = hc.submit_verdict(run_id, "pass", "none", "code")
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
2. No source/diff/plan content in tool responses — only facts + verdict
3. Provenance: fapony-verified facts are `verified`, agent claims stay `unverified` until cross-referenced
4. Schema is backward-compatible — new fields added, old fields never changed
