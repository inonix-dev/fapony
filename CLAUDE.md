# fapony — Knowledge Base

## What is fapony

**The plan workflow and token-saving lookups for teams that write code with agents** — plans run
chunk by chunk (`fapony plan`), convention debt (`fapony debt`), a lint baseline, code lookups
(`review-seed`, `analyze`), plus a usage reader that reports what it all costs in tokens.
**Memory — decisions, bugs, notes — is not fapony's any more:** it moved to **fael** on 2026-09-25
(`~/Project/fael/cl-fael`; Rust, one binary, its own MCP server + Stop/SessionStart/read hooks).
fapony reads fael (`src/fael.ts`) and never writes it. · fapony is now the owner's personal tool:
bug fixes and workflow only.

**North star:** **agents accumulate no pain — so they never build the abstraction themselves.**
Every session one is born anew, writing its 37th `try/catch` as cheerfully as the first, while wrappers
like `failWith` / `BaseInitClass` get built by *people* who were hurt repeatedly enough to remember.
fael remembers the pain; fapony's job is the other two thirds:
**say when a shared thing is due → track how far the migration has gone** — and keep plans cut into
chunks so no session drags the last one's context along.

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

## Why the core moved from ledger to mem + debt (2026-09-19) — and mem to fael (2026-09-25)

Ledger (agents grading their own work) capped out on 3 measured problems: self-grading bias differs per
model (never cite cross-model quality ranking as fact) · grade inflation (24 fail rows all-time — too small
for a per-file mechanic) · market narrower than assumed (only people paying out of pocket care "which model
is worth it"). **What survived: tokens** — from session logs, can't be gamed.

| Believable | Not believable |
| --- | --- |
| tokens / cost from session logs · git facts (commits, files, shas) · checker results (eslint/knip/tsc) · debt regex matches | grades an agent gave itself · "typecheck fully passes" with no exit code · the word "fixed" |

Ledger wasn't deleted, just frozen as a *pain sensor*: fail/`scope_mismatch`/`spec_gap` verdicts with
`files[]`+`note` feed repeat-pain-zone clustering — never the grade itself. Full story: `fael find "why the core moved"`.

---

## Three layers, and the lines that must never blur

| | **core — plan + debt** | **usage — day one** | **ledger — frozen** |
| --- | --- | --- | --- |
| Code | `src/plan/` `src/debt/` `src/lint-baseline.ts` `src/fael.ts` (read-only) | `src/session/` `src/usage/` `src/digest/` | `src/db/` (store only) `src/stats/` `src/report/` `src/context/` `src/gate.ts` |
| Writes | plan files it was told to move (`plan sweep --apply`) | read-only (cache) | 1 graded row into `~/.config/fapony/state.db` |
| Status | where new work lands | the source of day-1 value | **no new features** — bug fixes only |
| If deleted | no fapony left | installers see N=0 and walk away | core still answers everything |

**The resulting rules:**
1. **The ledger must never gate core, and vice versa** — `fapony debt` / `fapony plan` must work
   with no `state.db`.
2. **Neither the ledger nor any fapony command writes memory** — a mem row is valuable because it is
   standalone prose someone or some agent deliberately wrote, not a generated log. (`plan sweep --apply`
   used to log a "shipped" decision row; dropped 2026-09-25 — the move is in git.)
3. **A new feature gets exactly one owning layer.** If you can't tell which layer it belongs to,
   you don't understand the problem well enough yet. Anything that stores or pushes memory belongs to
   fael, not here.

**Runtime:** Bun-only · new deps must be `await import()`ed on the path that actually uses them —
`hook-edit-hint` spawns on every Edit and `fapony.ts` static-imports every module, so startup stays
≤ ~100ms (a lone `require("typescript")` = 92ms can break it single-handedly).
**State:** SQLite at `~/.config/fapony/state.db` (WAL) — `FAPONY_STATE_DIR` can move it. ·
`edit-track/` and `hint-log/` in the same stateDir are the edit-hint dedupe + fire log (disposable).
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
src/plan/       fapony plan [<PLAN.md>] | sweep | check — plan files + open fael rows about them
src/fael.ts     the one memory reader: `fael find --json` → MemRow (fael missing = ok:false, never a throw)
src/core/       pure layer — config/types/pricing/safety/parse/format/debt-*/enums/hint-log/hook-helpers/fapony-dir (never import back up into features/adapters/db-store)
src/adapters/   cli.ts + hooks/ (edit-hint, mv-guard, git-autonomy) + mcp/ (ledger report tools only — no server)
src/hook.ts     shim re-export → src/adapters/hooks/ (the OpenCode plugin imports it — don't delete)
src/memory.ts   config.memory shell helpers for the frozen ledger gate (user-configured commands only)
src/debt/       fapony debt — layer 3 "which files haven't migrated yet" (live, never persisted)
src/lint-baseline.ts  separates "already red" from "I made it red"
src/conventions-seed.ts  fill-signal at init — wrapper detector reads a snapshot, never touches history
src/map.ts      extractExports/extractBody (parse gate injectable via ExportScanner, default Bun.Transpiler)
src/seed/       plan-seed · review-seed (lookup at execute time)
src/session/    per-client passive usage reader + activeSession
src/usage/      fapony usage-web — reads the cache, never touches session logs
src/digest/     fapony digest — fael rows, plans, usage cache, and verdicts on one page
src/install/    one file per client + skills.ts
src/db/ (store only) · src/stats/ src/report/ src/context/ src/gate.ts   ← ledger (frozen)
src/*.ts        math · init · telemetry · setup · update · analyze · price/ · web/
                (root parse/safety/util are shims → core; don't edit the wrong copy)
skill/          <name>/SKILL.md — symlinked into clients by `fapony install`
templates/      PLAN.md / SPEC.md — what `fapony init` lays down
test/           one file per src module + test/mcp/ · test/install/ · test/telemetry/
```

---

## Client support — what works on whom (updated 2026-09-25)

`fapony install` knows 5 clients (Cursor dropped 2026-09-25 — MCP + Stop were all it got). **Memory
wiring — MCP, Stop, SessionStart, per-file read context — is `fael install`'s job**; `fapony install`
removes its own old entries for those (Claude settings.json, OpenCode plugins) and never writes them.

| | claude | opencode | zcode | codex | antigravity |
| --- | --- | --- | --- | --- | --- |
| Edit hint — importer count + convention debt before a shape change | ✅ before | ✅ after (edit+write) | — | — | — |
| Plan-mv guard — deny raw `git mv` of a plan into done/ | ✅ | — | — | — | — |
| Skill symlink → `~/.claude/skills` | ✅ | ✅ | — | — | — |
| Skill symlink → `~/.agents/skills` | — | — | ✅ | ✅ | ✅ |
| `usage-scan` reads that client's session log | ✅ | ✅ | ✅ | ✅ | — |

Claude Code fires *before* the tool call (`PreToolUse` → `additionalContext`); OpenCode fires *after*
(`tool.execute.after` — mutate `output.output`, never throw, or it blocks the tool), so OpenCode sees the
hint one step later. · **OpenCode is the only client whose hooks are baked files** — `fapony update` /
`fapony install --platform opencode` refresh them in a fresh process; every other client runs a
`fapony hook-*` command resolved at run time, so `git pull` refreshes it for free.

## Memory lives in fael

Record while you work, always with `--files` — through fael's MCP tools (`add` / `find` / `close`) or its CLI:

```bash
fael kickoff                                   # what this session should know
fael add decision "what was decided, and why" --files a.ts,b.ts
fael add issue "what broke" --files a.ts       # kind issue = a bug
fael add note "what chunk N+1 must know" --files a.ts,.fapony/plan/PLAN-x.md
fael close <id> "fixed in <sha>"
fael find --files a.ts
```

- **Plan handoff notes put the PLAN path in `--files`** — that is how `fapony plan PLAN-x.md` finds them
  (basename match, so they survive the move to done/).
- **Here `.fapony/` is gitignored and `.fael/` is excluded via `.git/info/exclude`** (public repo — plans and
  memory are internal notes), so both are readable from this machine only. `.fapony/evidence.json` is likewise
  uncommitted — the exception holds because one person edits here.
- Known gap (fael 0.0.4): `fael find --json --all` prints inline `closed` but not close-file rows, so
  digest still counts a natively closed issue as open until fael emits them.

---

## Convention debt — `fapony debt`

Layer 3, which nobody answers: *"we decided this 6 months ago — how far along is the move?"*

- A convention is defined in the **repo being measured** (`<repo>/.fapony/conventions.json` — the nearest
  `.fapony/`, same resolver as `fapony plan`). · **fapony knows neither React nor Hono, and must not.**
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
  "memory": { "close": ["..."], "kickoff": ["..."] },
  "telemetry": { "enabled": false, "endpoint": "https://your-server/ingest" },
  "paths": { "stateDir": "~/.config/fapony", "doneDir": ".fapony/done" },
  "safety": { "deny": ["reset\\s+--hard", "clean\\s+-[a-z]*f", "checkout\\s+--\\s", "git\\s+stash"] },
  "usageWeb": { "port": 8080, "hostname": "127.0.0.1" }
}
```

- `memory` — commands the frozen ledger gate runs on a pass (close/kickoff); **no default wiring** since
  2026-09-25. Omitted or `null` = off.
- `telemetry` — opt-in only (omitted or `null` = off), see [TELEMETRY.md](TELEMETRY.md).
- env overrides: `FAPONY_CONFIG` · `FAPONY_STATE_DIR` (beats `paths.stateDir`).
- Getters are centralized in `src/core/config.ts` — never re-hardcode defaults at call sites.
- **Never add a config field derivable from structure** (`plan/` `spec/` already work this way).

---

## Edge cases already handled

Moved to [docs/edge-cases.md](docs/edge-cases.md) — **`grep` there when behavior looks oddly familiar**
(every row is a trap that already cost real time). A lookup 90% of sessions never need, so it should never be
paid into context every time.

---

## History

Execute→review→fix CLI loop → deleted (client's own model does it better) → ledger (agents grading
themselves) → capped out → mem + debt, which is where fapony began → mem moved out to fael
(2026-09-25), fapony keeps plans + debt + lookups. Surviving relics: the
`runs`/`events` schema, `review.maxRounds`, plan/spec templates, all skills. **Both core moves came from
measurement, not feeling.** Full story: `fael find "History"`.

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
5. **`assertSafe()` on every shell command** spawned from config (ledger memory/evidence/install), including ones from
   templates.
6. **fapony may write files in the target worktree when the owner says so** — restated as three checkable rules:
   - **6a runtime state never lives in a worktree** — `state.db` is `~/.config/fapony/` only
     (fael's log is a different thing — it is the *team's*, so it belongs in the repo). · Check: the db path
     must never come from an arg/config pointing at a worktree.
   - **6b commands that read code must have no write side effects** — `analyze` `debt` `lint-baseline`
     `review-seed` `stats` `digest` `report` `plan` (not `plan sweep --apply`) may write only paths the user pointed at (`--out` /
     a filename in argv). · New commands that read code fall under this automatically.
   - **6c overwriting what exists = ask first, or refuse.** · **Consent is not prohibition.**
7. **Record memory in fael while you work, always with `--files`.** Write `decision` when you decide
   something the next session would puzzle over, `issue` when you find something broken, `note` when a chunk
   lands. · A row without `--files` is unfindable when that file is touched next = writing it was writing nothing.
8. **fael's Stop hook enforces the row, not fapony.** fapony's Stop / SessionStart / read-hint / bug-marker
   hooks were deleted 2026-09-25 (e0910f9) — measured: re-read hint never broke a 111-read loop, size hint
   only added 2KB on top of the full read, mem lines duplicated fael's own push. Anything that nags an agent
   to record belongs in fael. · `verdict_submit` stays off every surface — the engine is in git, revivable
   as a CLI.
9. **Asking doesn't work; enforcing does.** Measured: exactly two things actually change behavior —
   required + enum + reject (`regime`) and the Stop hook. · Everything a rule file says agents "should" do has no
   measurable effect. · **So a feature that relies on "the agent will remember to do it" = not done.**
10. **`project_health_context` is not a pre-edit reflex.** The true rework base rate is
    1% (canalis) / 9% (fapony) — too low to warn on. · The engine still exists (`src/context/`); **never
    enforce it, never wire it back into any hook or MCP surface.**
11. **Execute plans one chunk at a time — never one long session.** Context in a single session only grows,
    never shrinks (measured: 300–500-step sessions burn tokens wildly out of proportion to the work done).
    Closing 1 chunk: tick the checkbox + stamp the TL;DR → its own commit →
    `fael add note "<what chunk N+1 must know>" --files f1,f2,<path/to/PLAN-x.md>` → **stop**. · The next
    session opens with `fapony plan PLAN-x.md` (unchecked chunks + those notes) instead of hauling the old
    transcript. · **If `review-seed` was run
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
      fael's `find` passes this; everything fapony still does is ordered by a human or fires from a hook,
      so fapony has **no MCP server** (removed 2026-09-25).
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
2. **Cross-project / cross-machine** — `runs.worktree` has been the key from the start. · Plans (and fael's
   log) live in the repo, so they cross machines over git for free.
3. **The owner holds their own data** — the db is on the user's machine at `~/.config/fapony/`, no server, no
   account. Telemetry opt-in, allowlist only.

Every feature must hold at least two. Holding none = one client could do it = don't build it.

**On new fields:** what holds is rule 1 (prove necessity) and required+enum+reject as the strongest tool —
"optional kills fill rate" was tried and measured wrong (`files[]` is optional yet fills 88%). Full
miscounting story: `fael find "miscounted twice"`.

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
change mid-flight**. · `fapony plan` counts checkboxes of the first `##` section only —
**never create MASTER.md**; every line of it is derivable anyway, and a hand-kept file always rots. ·
`status` / `blocked_by` / `blocks` / `superseded_by` are read by `fapony plan check` (dangling refs,
blocker shipped but dependent still blocked, waiter cycles, blocked with all chunks ticked) and by
`fapony plan sweep` (blocked view + `🔓` unblock hint on `--apply`).

**Ticked shas are verified, not trusted:** `fapony plan check` scans ticked lines in plan/ + done/ — a sha missing
from git history or not an ancestor of HEAD becomes an issue (bare hex words git never heard of stay silent unless
cited next to a real sha). · `fapony plan <PLAN.md>` prints one ⚠ closure line for the last ticked chunk when its sha doesn't
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
# ── core: plan + debt (memory is fael: fael add | find | close | kickoff) ──
fapony plan [<PLAN.md>]              # active plans + next chunk · one plan: unchecked chunks + open fael rows
fapony plan sweep [<PLAN.md>] [--apply]  ·  fapony plan check [--quiet]
fapony debt [--id a,b] [--where <path>]   # which files haven't migrated to a declared convention (live, read-only)
fapony lint-baseline [--cmd ...] [--diff]   # separate "already red" from "I made it red"
fapony digest [--since 7d|YYYY-MM-DD] [--format text|html] [--json] [--out FILE]
# ── day-1: usage ──
fapony usage-scan                    # scan session logs → usage-cache.jsonl (incremental)
fapony usage-web [port]              # dashboard comparing usage from cache (never touches session logs)
fapony price-scan                    # refresh the model price table
# ── lookup (read-only, never touches state) ──
fapony analyze [path]                # hub/orphan/cycle/changed-untested — live graph, never persisted (TS/JS + Python .py/.pyi; stdlib→external, no sys.path)
fapony review-seed [--staged|--commit <sha>|--range <a...b>|--files f1,f2,dir|--plan <PLAN.md>] [--body sym[,sym]] [--callers sym[,sym]]
fapony plan-seed <name> [--spec] [--scope <path>[,<path>]]...
# ── hooks (wired by `fapony install`) ──
fapony hook-edit-hint                # PreToolUse Edit — importer count + convention debt of the file being edited
fapony hook-mv-guard                 # PreToolUse Bash — deny raw `git mv` of plan files into done/, use `fapony plan sweep --apply` instead (Claude)
# ── ledger (frozen — bug fixes only) ──
fapony stats [--mode verdict [--regime code|fix|review|plan|inquiry|test]]
fapony report <run-id>  ·  fapony report-web [file]
# ── setup ──
fapony init <path> [--rules] [--yes]  ·  fapony install [--all|--platform <name>|--dry-run]  ·  fapony setup
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

**Dead code goes through `bunx knip@6`** ([knip.json](knip.json) ignores `templates/**` because `fapony init`
lays that folder down in other repos, so it can never have an importer here). · Never gate CI on it — a gate that
must be unlocked every time just teaches skipping. · **Read the output right: it reports _unused exports_, not
unused functions.** Remove the word `export`, not the function.

---

## No MCP server (removed 2026-09-25)

fapony's MCP server carried only memory tools (`mem_find` / `mem_add` / `mem_close`); those are fael's now
(`find` / `add` / `close`). **Removed and never coming back:** `verdict_submit`, `fapony_usage`, `plan_list`,
`fapony_stats`, `project_health_context`, `verification_report`, `handoff_check`, `handoff_collect` — each
failed rule 13 (only a human ever called it, or the CLI already answers it at zero rent) or rule 2 (measured
value was tiny). The report/check/collect engines under `src/adapters/mcp/tools/` stay because
`fapony report` calls them. Full rationale: `fael find "MCP tools removal"`.

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
