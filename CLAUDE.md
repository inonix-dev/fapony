# fapony — Knowledge Base

## What is fapony

**The project's pain memory, for teams that write code with agents** — a mem log (`.jsonl` in the repo)
+ convention debt (`fapony debt`) + a lint baseline, plus a usage reader that reports what each of them
costs in tokens · shipped as an MCP server (`fapony mcp` — stdio JSON-RPC) any agent can call.

**North star:** **agents accumulate no pain — so they never build the abstraction themselves.**
Every session one is born anew, writing its 37th `try/catch` as cheerfully as the first, while wrappers
like `failWith` / `BaseInitClass` get built by *people* who were hurt repeatedly enough to remember.
fapony is the only thing in the room that remembers instead. Its job:
**remember the pain → say when a shared thing is due → track how far the migration has gone.**

**The unit of value is tokens, not quality** (pivoted 2026-09-19 — see "Why the core moved") — the people
who actually hurt are the ones **paying for their own plan**, not devs on a company budget, so every feature
must answer **"how many tokens does it save"**, not "how much better is the code" — the latter is unprovable
and nobody pays for it. · A measured example: `review-seed --files` over 5 files, 2,146 lines = 3.7KB
(~940 tokens) vs ~35k tokens to read all 5 files.

**What fapony is *not* for: finding dead code / duplicated code** — knip / madge / dependency-cruiser /
jscpd do that better. · **knip is a `checker`, not a competitor** — `debt.ts` has an iron rule:
`checker != null` = fapony stays silent, so dead exports / barrels get wired as the `"checker"` of that
convention instead of a new detector. · The genuinely empty slot is **layer 3: "which files haven't
migrated yet"** — eslint says this line is wrong, CLAUDE.md says what the rule is, **nobody says we
decided this 6 months ago and have moved 11 of 47.**

---

## Why the core moved from ledger to mem + debt (2026-09-19)

Ledger (agents grading their own work) capped out on 3 measured problems: self-grading bias differs per
model (never cite cross-model quality ranking as fact) · grade inflation (24 fail rows all-time — too small
for a per-file mechanic) · market narrower than assumed (only people paying out of pocket care "which model
is worth it"). **What survived: tokens** — from session logs, can't be gamed.

| Believable | Not believable |
| --- | --- |
| tokens / cost from session logs · git facts (commits, files, shas) · checker results (eslint/knip/tsc) · debt regex matches | grades an agent gave itself · "typecheck fully passes" with no exit code · the word "fixed" |

Ledger wasn't deleted, just frozen as a *pain sensor*: fail/`scope_mismatch`/`spec_gap` verdicts with
`files[]`+`note` feed repeat-pain-zone clustering — never the grade itself. Full story: `fapony mem find "why the core moved"`.

---

## Three layers, and the lines that must never blur

| | **core — mem + debt** | **usage — day one** | **ledger — frozen** |
| --- | --- | --- | --- |
| Code | `src/memory.ts` `src/debt/` `src/lint-baseline.ts` `src/adapters/mcp/tools/mem.ts` `src/init-mem.ts` | `src/session/` `src/usage/` `src/digest/` | `src/db/` (store only) `src/stats/` `src/report/` `src/context/` |
| Writes | `.jsonl` in the measured repo (the team's) | read-only (cache) | 1 graded row into `~/.config/fapony/state.db` |
| Status | where new work lands | the source of day-1 value | **no new features** — bug fixes only |
| If deleted | no fapony left | installers see N=0 and walk away | core still answers everything |

**The resulting rules:**
1. **The ledger must never gate core, and vice versa** — `fapony debt` / `mem_find` must work
   with no `state.db`.
2. **The ledger must never write into a worktree** — a past proposal had `verdict_submit` auto-write
   a mem row; **rejected**: it forces the hottest path to spawn a shell from config and breaks
   wherever `.fapony/` is absent. · More importantly — a mem row is valuable because it is standalone
   prose someone or some agent deliberately wrote, not a generated log.
3. **A new feature gets exactly one owning layer.** If you can't tell which layer it belongs to,
   you don't understand the problem well enough yet.

**Runtime:** Bun-only · new deps must be `await import()`ed on the path that actually uses them — `fapony mcp`
starts on every session of every client and `fapony.ts` static-imports every module.
Check: initialize round trip ≤ ~100ms (measured 63ms · a lone `require("typescript")` = 92ms
can break it single-handedly).
**State:** SQLite at `~/.config/fapony/state.db` (WAL) — `FAPONY_STATE_DIR` can move it. ·
`read-track/<session>.jsonl` in the same stateDir is the read-hint log (disposable per session).
**Topology:** `Project/fapony/` is an empty folder holding two repos as siblings —
`fapony/fapony/` = main checkout (the owner touches it alone) · `fapony/cl-fapony/` = dev
(a separate `.git` clone — agents work here only) · **the parent must have no `CLAUDE.md`**, or an
agent opened in `cl-fapony/` loads the same file twice (the reason for the split, 2026-09-20).
**License:** MIT, public from the first commit.

---

## Architecture

The per-**file** map lives in [docs/architecture.md](docs/architecture.md) — read it when placing new code,
not every session:

```
fapony.ts       7-line dispatch → src/adapters/cli.ts
src/mem/        fapony mem <add|close|find|kickoff|done|stale|claim|release|synced|plan-sweep|plan-check|rotate>
src/memory.ts   shell adapter + config (mem-log reader lives in src/core/mem-log.ts)
src/core/       pure layer — config/types/pricing/safety/parse/format/debt-*/enums/hint-log/hook-helpers (never import back up into features/adapters/db-store)
src/adapters/   cli.ts + hooks/ (stop/read-hint/edit-hint/session-start) + mcp/ (transport, evidence allowlist, 3 tools)
src/hook.ts     shim re-export → src/adapters/hooks/ (has real importers — don't delete)
src/debt/       fapony debt — layer 3 "which files haven't migrated yet" (live, never persisted)
src/lint-baseline.ts  separates "already red" from "I made it red"
src/conventions-seed.ts  fill-signal at init — wrapper detector reads a snapshot, never touches history
src/map.ts      extractExports/extractBody (parse gate injectable via ExportScanner, default Bun.Transpiler)
src/seed/       plan-seed · review-seed (lookup at execute time)
src/session/    per-client passive usage reader + activeSession
src/usage/      fapony usage-web — reads the cache, never touches session logs
src/digest/     fapony digest — mem log, plans, usage cache, and verdicts on one page
src/install/    one file per client + skills.ts
src/db/ (store only) · src/stats/ src/report/ src/context/   ← ledger (frozen)
src/*.ts        gates · math · init · init-mem · telemetry · setup · update · analyze · price/ · web/
                (root parse/safety/util are shims → core; don't edit the wrong copy)
skill/          <name>/SKILL.md — symlinked into clients by `fapony install`
templates/      PLAN.md / SPEC.md — what `fapony init` lays down
test/           one file per src module + test/mcp/ · test/install/ · test/telemetry/
```

---

## Client support — what works on whom (updated 2026-09-21)

`fapony install` knows 5 clients. · **MCP is the only piece all of them get.** · Hooks/hints are per-client
and **fire in different order** — Claude Code fires *before* the tool call (`PreToolUse` → `additionalContext`)
while OpenCode fires *after* (`tool.execute.after` — the only annotate channel available; must mutate
`output.output`, never throw, or it blocks the tool). So OpenCode sees warnings one step later.

| | claude | opencode | cursor | zcode | codex |
| --- | --- | --- | --- | --- | --- |
| MCP 3 tools | ✅ | ✅ | ✅ | ✅ | ✅ |
| Stop hook — refuse to end a turn with commits but no new mem row | ✅ | — | ✅ | — | ✅ after trust |
| Read hint — big file + debt/mem lines | ✅ before | ✅ after | — | — | — |
| Re-read hint — repeat read of the same file, mtime unmoved | ✅ before | ✅ after | — | — | — |
| Edit hint — importer count before a shape change | ✅ before | ✅ after (edit+write) | — | — | — |
| Commit hint — `git commit` → record a mem row (and `kind:bug` on a fix-type commit) | — | ✅ after | — | — | — |
| SessionStart — fire `mem kickoff` as context | ✅ | ✅ first dispatch only | — | — | ✅ after trust |
| Skill symlink → `~/.claude/skills` | ✅ | ✅ | — | — | — |
| Skill symlink → `~/.agents/skills` | — | — | — | ✅ | ✅ |
| `usage-scan` reads that client's session log | ✅ | ✅ | — | ✅ | ✅ |

`—` = not wired yet, not impossible. **Hints live on hooks, not MCP, on purpose** — they must fire mid-turn
without the agent thinking of it (the MCP-vs-CLI test, rule 13). · **OpenCode is the only client whose hooks
are baked files**; every other client writes a `fapony hook-*` command resolved at run time, so `git pull`
refreshes it for free — `fapony update`/`fapony install --platform opencode` refresh OpenCode's baked plugin
in a fresh process instead. Full mechanics: `fapony mem find "hook mechanics"`.

## Memory: `.fapony/.memory/log.<you>.jsonl` (append-only)

**This is the core** — the log is designed as the project's shared brain, kept in the repo rather than in
`state.db` (per-machine, never cloned). · File names come from `git config user.name` — one file per person,
so nothing ever merge-conflicts, and any repo that commits its `decision` / `bug` / `note` rows carries them to
every clone.

**Record while you work — don't wait to be asked.** Nothing writes rows for you; only the agent running does:

```bash
fapony mem kickoff .fapony/plan/PLAN-x.md   # open a session with this
fapony mem add decision "what was decided, and why" --files a.ts,b.ts
fapony mem add bug "what broke" --files a.ts
fapony mem add note "state the next session must know"
fapony mem close <id> "fixed in <sha>"
fapony mem find "usage-web"
```

- **`--files` matters most** — without it the row falls through the floor when clustering for repeat-pain
  zones. · A repo whose log predates `--files` gets one `fapony init-mem` **before** anyone concludes anything
  from the log (measured: vela had 2,672 rows with zero `files[]` for exactly this reason).
- Write every row **standalone** — it gets read months later with none of this conversation attached.
- `close` is the only thing that closes a `bug`. Without it the list only grows.
- **Every kind is live; none deprecated** — `decision` / `bug` / `note` are the agent's own call, while
  `next` / `hold` / `claim` / `release` / `synced` / `stale` are `mem.ts`'s own bookkeeping.
- **Read back via MCP `mem_find`** (`files[]` / `text` / `kind` / `since` / `limit` — no default filter).
- **The cluster unit is the *zone*, not the file**, and count **1 row = 1 event** — counting
  file-hits once gave `layouts/quick 10×`, which was inflated (one verdict touching 9 files counted 9);
  recounting gave `server/services` 6× · `server/routes/v1` 6× with only **2 zones** at ≥5 hits
  (fixed 2026-09-19 after re-measuring with `.fapony/plan/pain-cluster.ts`).

**This repo's `.gitignore` ignores `.fapony/` wholesale** (public repo — mem/plans are internal notes),
so here the log is readable from this machine only, never shared via clone. · `.fapony/evidence.json`
is likewise uncommitted even though the evidence rule says commit it — the exception holds because one person
edits here; multi-person repos must add the negation themselves.

**Why this rule isn't in `SERVER_INSTRUCTIONS`:** mem.ts belongs to the *project*, not to fapony,
and exists only for whoever ran `fapony init`. · `SERVER_INSTRUCTIONS` is paid every session by everyone
connected over MCP — most of them have no such file, and the text would become an instruction to run a command
that fails.

---

## Convention debt — `fapony debt`

Layer 3, which nobody answers: *"we decided this 6 months ago — how far along is the move?"*

- A convention is defined in the **repo being measured** (`<repo>/.fapony/conventions.json` — same resolver
  as the mem log). · **fapony knows neither React nor Hono, and must not.**
- 1 convention = the pattern to use (ok) + the pattern meaning not-yet-migrated (stale) + scope (where)
  + file conditions (guard).
- **Iron rule: `checker != null` = fapony stays silent.** Re-reporting what eslint already reports is an
  abstraction with a single implementation, and teaches agents to skip both.
- Computed live every time, persisted nowhere (like `analyze` — a cache is pure debt; a frozen list
  silently rots like MASTER.md).
- Cap: a stale regex matching 250+ files is a broken regex, not a convention → dropped, and said plainly.

`fapony lint-baseline` is its pair: separates "already red" from "I made it red" by comparing
`path:rule-id` (not line numbers — lines shift on every edit) at base_sha. · Report-only, never blocks. ·
**This is "save tokens" made concrete**: an agent that can't see the baseline `fix all`s first, and the real
work drowns in a single giant diff (from the owner, verbatim: *"138 spots across ~40 files unrelated to the work"*).

---

## DB schema (2 tables only — never add)

The ledger is frozen — this schema exists for compatibility, not extension:

```sql
runs(id, worktree, plan, mem_id, status, base_sha, round, created_at, updated_at)
events(id, run_id, ts, kind, data)   -- kind: spawn|gate|stop|memory_claim_closed|verification_report
```

A `runs` row = 1 measured unit of work, created by `verdict_submit` when no run was left open. ·
Events are an audit trail of facts, not a transcript.

---

## Config schema

Every field optional, `fapony.config.json` itself optional — `src/core/config.ts` is source of truth:

```json
{
  "worktrees": { "<key>": "<absolute-path>" },
  "review": { "maxRounds": 2 },
  "memory": {
    "claim": ["fapony", "mem", "claim", "{id}"],
    "close": ["fapony", "mem", "close", "{id}", "{msg}"],
    "add":   ["fapony", "mem", "add", "{kind}", "{text}"],
    "kickoff": ["fapony", "mem", "kickoff"]
  },
  "telemetry": { "enabled": false, "endpoint": "https://your-server/ingest" },
  "paths": { "stateDir": "~/.config/fapony", "planDir": ".fapony/plan", "doneDir": ".fapony/done", "specDir": ".fapony/spec", "memDir": ".fapony/.memory" },
  "safety": { "deny": ["reset\\s+--hard", "clean\\s+-[a-z]*f", "checkout\\s+--\\s", "git\\s+stash"] },
  "usageWeb": { "port": 8080, "hostname": "127.0.0.1" }
}
```

- `memory: null` = the whole layer off, no error.
- `telemetry` — opt-in only (omitted or `null` = off), see [TELEMETRY.md](TELEMETRY.md).
- env overrides: `FAPONY_CONFIG` · `FAPONY_STATE_DIR` (beats `paths.stateDir`) ·
  `FAPONY_NO_REREAD_HINT=1` (kill switch for the re-read hint — neither fires nor logs) ·
  `FAPONY_NO_BUG_BLOCK=1` (kill switch for the bug-signal block — no forced `kind:bug` row).
- Getters are centralized in `src/core/config.ts` — never re-hardcode defaults at call sites.
- **Never add a config field derivable from structure** (`plan/done` and `.memory` already work this way).

---

## Edge cases already handled

Moved to [docs/edge-cases.md](docs/edge-cases.md) — **`grep` there when behavior looks oddly familiar**
(every row is a trap that already cost real time). A lookup 90% of sessions never need, so it should never be
paid into context every time.

---

## History

Execute→review→fix CLI loop → deleted (client's own model does it better) → ledger (agents grading
themselves) → capped out → today's mem + debt, which is where fapony began. Surviving relics: the
`runs`/`events` schema, `review.maxRounds`, plan/spec templates, all skills. **Both core moves came from
measurement, not feeling.** Full story: `fapony mem find "History"`.

---

## Rules for AI agents

1. **Never build an abstraction with a single implementation** — no scaffolding for the future.
2. **Measure before building — every time.** This repo reversed itself on numbers 4 times already (a `files[]`
   fill rate believed 0 but really 88% · vela's zone cluster inflated by file-hits · self-grading bias ·
   line counts back when opening a new repo was on the table). **All four prior beliefs were wrong.** · Always
   ask for the base rate before writing a detector — 1–9% has already killed per-file alert features.
3. **Push only the branch you're on — never touch `main`, never `--force` / `--force-with-lease`.**
   Agents may open PRs, never merge them themselves.
4. **One concern per commit** · **commit finished work immediately, don't ask first.** · **Done = typecheck
   passes + `bun run test` passes** (the script = `--parallel` + `--timeout 20000` against flakes on slow machines —
   never use bare `bun test` as a gate) · while iterating use `bun run test:changed` (only files the diff touches);
   still red = not done, don't commit over it.
5. **`assertSafe()` on every shell command** spawned from config (memory/evidence/install), including ones from
   templates.
6. **fapony may write files in the target worktree when the owner says so** — restated as three checkable rules:
   - **6a runtime state never lives in a worktree** — `state.db` is `~/.config/fapony/` only
     (the mem log is a different thing — it is the *team's*, so it belongs in the repo). · Check: the db path
     must never come from an arg/config pointing at a worktree.
   - **6b commands that read code must have no write side effects** — `analyze` `debt` `lint-baseline`
     `review-seed` `stats` `digest` `report` may write only paths the user pointed at (`--out` /
     a filename in argv). · New commands that read code fall under this automatically.
   - **6c overwriting what exists = ask first, or refuse.** · **Consent is not prohibition.**
7. **Record mem while you work, always with `--files`.** This is the rule that replaces "file a verdict every
   time" as the core habit. · Write `decision` when you decide something the next session would puzzle over,
   `bug` when you find something broken, `note` when a chunk lands. · A row without `--files` falls through the
   floor at cluster time = writing it was writing nothing.
8. **The Stop hook enforces a mem row** ([src/hook.ts](src/hook.ts) — shim; logic in `src/adapters/hooks/`):
   ending a turn with commits but no new mem row = blocked once. · **Ending a turn that declares a bug with no
   `kind:bug` row = blocked once per session.** · What counts as "a bug" lives in one place —
   [src/adapters/hooks/bug-markers.ts](src/adapters/hooks/bug-markers.ts): `BUG_MARKERS` (announcement phrases,
   multi-language, open for extension) **or** a `fix:` / `bugfix:` / `hotfix:` commit type (language-independent
   — only the type token is English). Free-text phrases can never be universal, so extend the list per language
   instead of inventing a new row kind — and never add symptom words ("broken", "dies silently"), which would
   fire on any turn that merely reads a bug report. · OpenCode has no stop hook, so its commit hint carries the
   same `kind:bug` nudge instead (rule 13). · No mem log at all = no block. ·
   `verdict_submit` is off the MCP surface (PLAN-verdict-to-mem) — the engine is in git, revivable as a CLI. ·
   The hook never grades in anyone's place — "who judges" stays separate from "who enforces recording"; only the
   latter can be automated. · Kill switch: `FAPONY_NO_BUG_BLOCK=1`.
9. **Asking doesn't work; enforcing does.** Measured: exactly two things actually change behavior —
   required + enum + reject (`regime`) and the Stop hook. · Everything a rule file says agents "should" do has no
   measurable effect. · **So a feature that relies on "the agent will remember to do it" = not done.**
10. **`project_health_context` is not a pre-edit reflex.** The true rework base rate is
    1% (canalis) / 9% (fapony) — too low to warn on. · The tool still exists; call it if you want, but
    **never enforce it, never put it back in `SERVER_INSTRUCTIONS`.**
11. **Execute plans one chunk at a time — never one long session.** Context in a single session only grows,
    never shrinks (measured: 300–500-step sessions burn tokens wildly out of proportion to the work done).
    Closing 1 chunk: tick the checkbox + stamp the TL;DR → its own commit →
    `mem.ts add note "<what chunk N+1 must know>" --files f1,f2 <path/to/PLAN-x.md>` (retype the path
    identically every time — `kickoff` compares raw strings) → **stop**. · The next session opens with
    `mem.ts kickoff <same path>` instead of hauling the old transcript. · **If `review-seed` was run
    this chunk, paste its file:line facts (signatures/importers) into the note, not just "what to do
    next"** — `review-seed` is stateless by design (no cache — measured 0.31-0.51s uncached even on a
    2,952-file repo, no scaling with file count, closed, don't re-propose without new data), so the note
    is the only place that lookup survives into chunk N+1; without it, N+1 pays the same lookup again
    from zero.
12. **A feature with no caller = delete.** Actually done: `fapony map` had no caller; plan-seed §2/§5
    measured 3/3 empty → −257 lines. · Convenience-side things prove themselves by being used, not by existing.
13. **Spend tokens smart — not "cut to the minimum" but "pay where it pays back."**
    Pay nothing and the agent knows nothing, and **data the agent doesn't know = data that doesn't exist.** ·
    What the agent knows every time is **input tokens**, which are cheaper than the **output tokens** it would burn
    guessing / reading whole files / fixing wrongly then re-fixing. · So the test isn't "is it big" but
    **"does this much input save more output"** (verbatim case: `review-seed --files` pays ~940 → dodges ~35k).
    - **MCP vs CLI splits here:** a schema in `tools/list` is **fixed rent** paid every session
      of every client even when never called, while a CLI command is **0 until run**. · Hence
      **what a human orders = CLI · what the agent must think of mid-turn unasked = MCP.** ·
      `mem_find` passes this; `fapony_stats` didn't because only a human ever asks it.
    - **Store enough; don't explain at length.** A field needing three paragraphs of explanation means you don't
      know what you're storing yet. · **If it can't be summarized in one sentence, the problem isn't understood
      well enough** (same shape as rule 3).
    - Write descriptions as **orders, not persuasion** — "send this along" is shorter and works as well as a
      paragraph on why it matters (rule 9: asking doesn't work; what works is required + enum + reject).
    - **The test for adding a new tool:** will the agent call it on its own mid-task? If the answer is
      "when the owner orders it" = CLI. · If there's no answer = don't add it yet.


---

## Moat — hold at least two of three

The one threat that can actually kill fapony comes in a single shape: **the client's own model doing it** —
the same shape that already absorbed the execute→review loop once. See History.

1. **Cross-client** — one yardstick over Claude Code + OpenCode (primary), ZCode, Codex.
   No client's session logs will ever cross to another, because nobody benefits from making them cross. ·
   `src/session/`'s 2,450 lines are this moat entire, and the most expensive thing to rewrite.
2. **Cross-project / cross-machine** — `runs.worktree` has been the key from the start. · The mem log lives in
   the repo, so it crosses machines over git for free.
3. **The owner holds their own data** — the db is on the user's machine at `~/.config/fapony/`, no server, no
   account. Telemetry opt-in, allowlist only.

Every feature must hold at least two. Holding none = one client could do it = don't build it.

**On new fields:** what holds is rule 1 (prove necessity) and required+enum+reject as the strongest tool —
"optional kills fill rate" was tried and measured wrong (`files[]` is optional yet fills 88%). Full
miscounting story: `fapony mem find "miscounted twice"`.

---

## Positioning — read [docs/positioning.md](docs/positioning.md) before writing README/launch copy

Not needed for a normal coding session — only when touching the README, a launch post, or marketing copy.

---

## Plan Core — the template for every plan

Uses [templates/PLAN.md](templates/PLAN.md) (`.fapony/plan/PLAN-<feature>.md`) and
[templates/SPEC.md](templates/SPEC.md) (`.fapony/spec/SPEC-<feature>.md`). · **4 iron rules:**
sections 1–4 never missing · every step in section 6 verifiable · section 8 linked back. ·
**plan = what/why/order, spec = how in detail** — never paste API shapes/schemas/edge cases into
plan section 7 directly; link to the spec.

**Frontmatter + TL;DR:** the header carries `kind` / `status` / `blocked_by` / `blocks` / `superseded_by` / `spec` / `priority`
(values always EN — an enum the tool reads), then a `## TL;DR` ≤15 lines that is the **only part allowed to
change mid-flight**. · `fapony mem kickoff` counts checkboxes of the first `##` section only —
**never create MASTER.md**; every line of it is derivable anyway, and a hand-kept file always rots. ·
`status` / `blocked_by` / `blocks` / `superseded_by` are read by `mem plan-check` (dangling refs,
blocker shipped but dependent still blocked, waiter cycles, blocked with all chunks ticked) and by
`mem plan-sweep` (blocked view + `🔓` unblock hint on `--apply`).

**Ticked shas are verified, not trusted:** `mem plan-check` scans ticked lines in plan/ + done/ — a sha missing
from git history or not an ancestor of HEAD becomes an issue (bare hex words git never heard of stay silent unless
cited next to a real sha). · `kickoff` prints one ⚠ closure line for the last ticked chunk when its sha doesn't
verify, and stays silent when it does. · A ticked box with no sha to check is a claim, not a close.

**Layout `.fapony/{plan,done,spec}`:** `done/` sits **beside** `plan/`, not inside — every relative
link survives the move, so archiving is `git mv` + sed of plan→plan links. · **No dates in filenames**
(the date lives in the header `> ✅ **shipped YYYY-MM-DD**` — "what landed when" derives from
`grep -h shipped .fapony/done/*.md | sort`). · **Specs are never archived** — the spec is a library,
and an unmoved spec = unbroken links.

**Wiring/refactor work needs no PLAN.md.** The pair actually used is `analyze <dir>` + `review-seed --files`
at open, closed by `review-pony` — deterministic at both ends, no LLM in between.

---

## CLI Commands

```bash
# ── core: mem + debt ──
fapony mem add <kind> "<text>" --files f1,f2 [spec.md]
fapony mem close <id> "<msg>"
fapony mem find ["<text>"] [--kind a,b] [--files f1,f2] [--since <N>d|YYYY-MM-DD] [--limit n] [--open]
fapony mem kickoff [<plan.md>] [--pick <n>]
fapony mem done | stale | claim | release | synced | plan-sweep | plan-check | rotate
fapony debt [--id a,b] [--where <path>]   # which files haven't migrated to a declared convention (live, read-only)
fapony lint-baseline [--cmd ...] [--diff]   # separate "already red" from "I made it red"
fapony init-mem                     # delete legacy .memory/ dirs + warn call sites still referencing them (data files untouched)
fapony digest [--since 7d|YYYY-MM-DD] [--format text|html] [--json] [--out FILE]
# ── day-1: usage ──
fapony usage-scan                    # scan session logs → usage-cache.jsonl (incremental)
fapony usage-web [port]              # dashboard comparing usage from cache (never touches session logs)
fapony price-scan                    # refresh the model price table
# ── lookup (read-only, never touches state) ──
fapony analyze [path]                # hub/orphan/cycle/changed-untested — live graph, never persisted
fapony review-seed [--staged|--commit <sha>|--range <a...b>|--files f1,f2,dir|--plan <PLAN.md>] [--body sym[,sym]] [--callers sym[,sym]]
fapony plan-seed <name> [--spec] [--scope <path>]...
# ── ledger (frozen — bug fixes only) ──
fapony mcp                           # MCP server — stdio JSON-RPC, 3 tools
fapony hook-stop                     # Stop hook — block turns with commits but no new mem row
fapony hook-read-hint                # 2 annotation kinds: whole-file read of a big file → review-seed ·
                                     # re-read of the same file in one session with unmoved mtime → grep
fapony hook-edit-hint                # PreToolUse Edit — importer count of the file being edited (Claude)
fapony hook-mv-guard                   # PreToolUse Bash — deny raw `git mv` of plan files into done/, use `plan-sweep --apply` instead (Claude)
fapony hook-session-start            # SessionStart — fire `mem kickoff` into context (silent with no mem log)
fapony stats [--mode verdict [--regime code|fix|review|plan|inquiry|test]]
fapony report <run-id>  ·  fapony report-web [file]
# ── setup ──
fapony init <path>  ·  fapony install [--all|--platform <name>|--dry-run]  ·  fapony setup
fapony update  ·  fapony telemetry show|send
```

**`review-seed --files` is lookup at *execute* time, not just review-pony's "Before".** It shows
every export with line numbers + every importer (uncapped). · **Before touching an unfamiliar file, fire this
instead of Reading the whole file**, then Read only the line ranges it points at. · **Directories work too**
(zone lookup — a dir expands to the source files under it, cap 40, and says so when cut). · Nonexistent paths
are dropped with a not-found notice instead of silently counting as changed. · Diff scopes
(`--commit` / `--range` / `--staged`) keep their old caps — that's the review's budget, not the lookup's.

```bash
fapony review-seed --files src/x.ts --body resolveScope,findScope --callers resolveScope
```

`--body` = declaration slices of the named exports. · `--callers` = symbol→symbol scan across the importers
the static graph sees (dynamic use is out of reach). · **Exports only** — a function that isn't exported
answers "no export named X in scope", not "doesn't exist".

**Dead code goes through `bunx knip@6`** ([knip.json](knip.json) ignores `templates/**` because `init-mem`
copies that folder into other repos, so it can never have an importer here). · Never gate CI on it — a gate that
must be unlocked every time just teaches skipping. · **Read the output right: it reports _unused exports_, not
unused functions.** Remove the word `export`, not the function.

---

## MCP Tools: fapony

`fapony mcp` — stdio JSON-RPC, **3 tools** (`mem_add` arrived with PLAN-agent-one-call ·
`plan_list` left 2026-09-20 · `fapony_usage` left 2026-09-20 for CLI · `mem_close`
arrived 2026-09-21 as a separate tool because a close row carries no `files[]` — see rules 12/13):

| Tool | Purpose |
|------|---------|
| `mem_find` | **The core** — search the mem log read-only: match the row's stored `files[]` first, then fall back to substring of text/spec/ref for old rows written before `--files` existed · every kind, no default filter · `memDir:null` = no mem (not "no match") |
| `mem_add` | **The core — the write half of `mem_find`.** Appends a mem row (`decision` / `bug` / `note` / `next` / `hold`) with `files[]` **required, rejected when empty** (rule 9: required works, asking doesn't) — a row that names no file is unfindable when you next touch that file |
| `mem_close` | **The core — the close half of `mem_add`.** Closes a row by id with a tombstone message (`ref` + `text`, no `files[]`) — a separate tool, not `kind:"close"`, because a schema whose required fields depend on another field's value is the most-miscalled shape there is |

**Removed and never coming back:** `verdict_submit`, `fapony_usage`, `plan_list`, `fapony_stats`,
`project_health_context`, `verification_report`, `handoff_check`, `handoff_collect` — each failed rule 13
(only a human ever called it, or the CLI already answers it at zero rent) or rule 2 (measured value was
tiny). Engines mostly stay in git/CLI, revivable if the shape of use changes. Full removal-by-removal
rationale: `fapony mem find "MCP tools removal"`.

See [docs/mcp-handcheck.md](docs/mcp-handcheck.md) for protocol, adapter examples, safety rules.

---

## code-review-graph — CLI only (MCP removed 2026-09-19)

The owner removed code-review-graph's MCP server because **it was almost never called** — schema rent
paid every session for near-zero return (rule 13, the same shape that got `fapony_stats`). ·
**The `code-review-graph` CLI is still on PATH and the graph still updates on every commit via the pre-commit hook.**

Use it to narrow scope before reading source — cheaper than scanning files, and gives callers/dependents/tests
that file search can't. · **But always confirm in source**: the graph reads the latest commit, not the file being
edited. · When graph and source disagree, **source wins.** · Empty results mean "not indexed" or "invisible
statically" — never "doesn't exist". · **No graph is no reason to stop — `fapony review-seed
--files` answers most of the same questions and is in-house.**
