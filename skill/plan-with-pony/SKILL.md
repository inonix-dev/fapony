---
name: plan-with-pony
description: Draft a plan + spec from "what's in your head" — one question, then a draft you correct. Vendor-neutral — works with Claude Code, OpenCode, Codex, ZCode. Pulls known failure patterns from fapony run history when it's wired up. Trigger on /plan-with-pony and when the user asks to plan or brainstorm a feature.
---

# plan-with-pony — start from what's in your head

You are helping a dev turn an idea into a plan + spec.

**Ask one question, then write a draft they can correct.** Correcting a wrong line costs a dev far
less than answering a blank question, so let the draft do the asking. Never open with a
questionnaire.

## Tone

- **Help the dev find what they already know** — you are not testing them
- **Never leave them stuck** — if they don't know, offer 2-3 options with consequences and let them
  point. "I don't know" is an answer you handle, not a failure to correct
- **Never start with "Why"** — start with "The thing about X is interesting..."
- **Never push back** — if an answer contradicts best practice, log it under constraints, don't argue
- **Never hold a plan hostage to a blank section** — write `_TBD — decide while building_`, move on

A plan is a starting position, not a contract. Say this out loud the moment a dev starts agonising:

> "This doesn't have to be right — it has to be good enough to start. You'll learn more in the
> first hour of building than in another hour of planning, and a second plan is cheap."

## Phase 0 — What the dev already said

Most devs arrive here *after* talking the idea through. Re-asking what they just explained is the
fastest way to make this skill feel like an interrogation.

Before asking anything, read back through the conversation you are already in and harvest it: goal,
scope, constraints, anything they ruled out. That harvest feeds the draft in Phase 2 — you never
need to ask about it again.

Started fresh with no prior conversation? Nothing to harvest. Go to Phase 1.

## Phase 1 — One question

Ask this, and nothing else:

> "What do you want to be able to do that you can't do today? Short is fine — I'll draft the rest
> and you correct me."

If the answer is under ~10 words, one follow-up:
> "What do you have to do today to get that result — where's the friction?"

If it runs long, summarise it back in one sentence and let them correct the summary.

That is the entire question phase. Everything else comes out of the draft.

## Phase 1.5 — Known patterns (fapony history, if available)

Before drafting, check what has gone wrong here before — these become *guessed constraints* in the
draft, which is worth far more than a question about constraints.

If the `project_health_context` MCP tool is available:

1. **Call it with no `worktree` argument** — patterns across *every* project sharing this fapony
   state db. Do this one always. It is the deeper well (more runs = more regimes covered, real
   recurring `reason_code`s) and it is the one nothing else in this skill duplicates.
2. **Then, only if Phase 1.6's `fapony plan-seed` did NOT run**, call it again with `worktree` =
   the **absolute path** to this repo (`git rev-parse --show-toplevel`). When the seed *did* run,
   skip this: the seed's `## Context (fapony)` block already carries the same project-scoped
   decisions and model fit, and calling it too pays for that block twice. Passing `files` with the
   paths the idea touches narrows it to file-scoped findings.

Every fapony tool scopes by absolute path — a bare repo name lands in a bucket later queries never
find.

Show what you got to the dev, labelled "this project" vs "all projects". If fapony isn't wired up,
or it says "not enough history yet", skip silently — never block drafting on this.

## Phase 1.6 — Seed the facts (`fapony plan-seed`, if the CLI is available)

If the `fapony` CLI is on PATH, run it **once** before drafting — with `--scope` when the dev's
idea already points at a directory (repeatable; without it the seed scans the whole cwd and
warns past ~300 files):

```bash
fapony plan-seed <feature> --spec --scope <path>
```

It writes `<planDir>/PLAN-<feature>.md` + `<specDir>/SPEC-<feature>.md` with the factual
sections pre-filled from the code itself — §2 Scope reports export-name prefixes that repeat
**across two or more directories** (a prefix confined to one directory is that directory's naming
convention, so it is not reported), §5 Risks from the import graph scoped to the requested paths,
and a `## Context (fapony)` block (recent mem decisions + which model holds up per task shape).
Every section is hard-capped (PLAN ≤ ~60 / SPEC ≤ 200 lines) and capped lines always say what was
cut. The CLI resolves plan-dir/spec-dir and refuses to overwrite (hard rule 9 — pick `-v2`).

What that buys you: the file, the frontmatter and §5 exist before you start, so the draft budget
goes on judgment — Goal, Done criteria, ordering — instead of on structure. So:

- **Read the seeded §2/§5 — skip the rest**, it is the empty template you are about to fill.
  Correct a seeded line only where the dev's idea contradicts it, and say so when you do
  ("the scan shows X but you want Y").
- **Fill the judgment sections** — §1/3/4/6/8 and the TL;DR. They start as `_agent เติม_` slots.
- The seeded lines are tagged `(source scan)` / `(fapony analyze)` — keep the tags so the dev can
  tell measured facts from your guesses.
- **Signatures live in the SPEC chunks only.** Never paste them into plan §7 — link to the spec.
- If the CLI is missing, skip silently and draft from scratch (Phase 2 as written) — never block
  on a missing tool.

## Phase 2 — Draft straight to the file

Write the full draft **now**, all eight sections, from the Phase 0 harvest + the Phase 1 answer +
the Phase 1.5 patterns — **or, when Phase 1.6 seeded a file, correct and complete that file
instead of writing from scratch** (its §2/§5 already hold the measured facts). Fill every
section — guessing where you have to.

```
1. Goal (why)                          5. Risks & Escape hatches (if it fails)
2. Scope (do / don't do)               6. Steps (what in which order)
3. Done criteria (how we know)         7. Examples (make it concrete)
4. Constraints / Hard rules            8. References
```

**Mark every guess `(guess)`.** A marked guess is the whole technique; an unmarked one breaks
hard rule #6.

**Write it to the file, not into chat** — a draft pasted in chat costs the plan body twice and
then sits in context all session. Corrections land as small edits instead of a re-draft.

**Resolve where plans live first — never assume `.fapony/plan/`.** Read
`<worktree>/fapony.config.json` for `paths.planDir` / `paths.specDir`, falling back to
`.fapony/plan` / `.fapony/spec`. Repos that keep plans beside the app (`apps/<app>/plan`) are
normal — writing to the default there scatters plans into a directory nobody reads.

`ls <planDir>/` and check `PLAN-<feature>.md` doesn't already exist — check `paths.doneDir`
(default `.fapony/done`) too, shipped plans live there. If it exists, don't overwrite: pick
`PLAN-<feature>-v2.md` or ask which one is stale. (Phase 1.6's CLI refuses on its own; drafting
by hand, this check is yours.)

**Editing a plan someone is executing right now is a different job from drafting one.** Ask the
dev, or call `plan_list` — it joins plan files against run history, so a plan with an open run is
one an agent is working from this minute. When that is the case:

- **Anything you add is an instruction, not a note.** A measured fact parked under "don't do"
  still reads as a to-do to an agent mid-execution — the numbers are what make it tempting.
- Park it in its own plan instead and leave **one line** in the live one, naming the *files* the
  live plan does not touch. A boundary in files survives a re-read; a boundary in intent does not.
- Never re-order or re-scope the chunks under it. Correct a wrong line, add nothing else, and tell
  the dev what moved so they can decide whether the running agent needs to know.

**Open the file with frontmatter, then a TL;DR** — together they let every later question about
this plan be answered from the first 40 lines instead of from 40KB:

```yaml
---
kind: unit                        # `tracker` = a checklist that never finishes; omit = unit of work
status: active                    # active | blocked | superseded (omit = not started)
blocked_by: PLAN-mdl-documents.md # or a sentence — required when status: blocked
blocks: PLAN-export-xlsx.md       # plans that cannot start until this one lands (comma-separated)
spec: SPEC-calendar.md            # if Phase 4 produced one
---
```

```markdown
## TL;DR
- **What:** …
- **Why:** … (the decision or the pain, not the implementation)
- **Done when:** … (testable)
- **Order:** what this waits on / what it unblocks
- **Progress:**
  - [ ] chunk 1 — …
  - [ ] chunk 2 — …
```

Only write the frontmatter keys you know — a new plan usually has `kind: unit` and nothing else.
`blocks` goes in whenever the conversation said "this has to come before X": frontmatter is the
only place that ordering stays true.

**The TL;DR is 15 lines, hard cap, and is the only part that changes while the work is in flight**
(tick a box, stamp a short sha). Everything below it is the agreement. A TL;DR allowed to grow
becomes a second copy of the plan, and then neither copy can be trusted. `plan_list` tallies the
checkboxes in the **first `##` section only**, so section 6 stays detail rather than status.

Section 6 — every step must be verifiable. Section 8 — must link back to anything it came from.
**Plan = what/why/order, spec = how in detail**: never paste API shapes, schemas, wireframes, or
edge-case tables into section 7; link to the spec instead. Full template: `templates/PLAN.md`.

Write the plan in the language the dev has been using (or the one they asked for) — they have to
read it. Section headings stay as the template has them, and **frontmatter keys and values stay
English** (`status: blocked`, not a translation): they are an enum a tool reads. TL;DR bullet
labels are prose — translate them freely, the checkbox tally doesn't care.

## Phase 3 — Hand back the guesses, not the plan

Then — the part that must not be dropped — invite corrections in chat, in ~8 lines:

- one line: what this plan does
- **every `(guess)` in the draft, one bullet each** — this list is what the dev actually corrects,
  and it is the only reason the draft was ever shown in chat
- the file path, then: **"Tell me what's wrong with it"** — never "is this ok"

> "Written to <planDir>/PLAN-<feature>.md. Guessed: <g1>, <g2>, <g3>. **Tell me what's wrong** —
> especially those. Blank sections are fine; we can decide those while building. Change it whenever
> building teaches you something — that's the plan working, not the plan failing."

Ask "what's wrong" and you get the real answer. Ask "is this ok" and you get "ok".

Corrections come back as edits to the file — change the lines they named, don't rewrite the plan.

### Then at most two follow-ups

After the corrections land, ask **only** about sections still empty *and* load-bearing. In practice
ordinary discussion leaves exactly these two blank:

**Done criteria** — if the draft has nothing objective in it:
> "If you looked at this later and thought 'it's done', what would you check? Commands that run,
> numbers that match, behaviour you'd see. Two or three is plenty."

**Constraints** — if nothing was ruled out:
> "Anything you already know is off-limits? Past pain, or policy like 'never git push' / 'never
> write outside the worktree'. If nothing comes to mind, that's fine too."

Everything else — risks, examples, step ordering — ships as-is or as `_TBD_`. Don't chase it.

## Phase 4 — Spec (optional)

Only if the dev asks, or the plan keeps trying to describe *how*:

> "Want a spec too? It holds the API contract, entity states, edge cases, example input/output —
> the detail the plan links to instead of carrying. I can draft one from the plan if you'd rather
> react than specify."

Then draft `<specDir>/SPEC-<feature>.md` (same config lookup as Phase 2) by:
- If Phase 1.6 already created it (`--spec`), edit that one — its Chunk index + signatures are
  the live scan; add the dev-facing detail (edge cases, examples, fail examples) on top
- Referencing sections from the plan directly — don't rewrite
- More concrete examples than abstract
- Include "fail examples" to make boundaries clear
- Opening with a backlink: `> **Used by:** [PLAN-<feature>.md](<relative path to planDir>/PLAN-<feature>.md)` — the
  plan links out, the spec links back, and the pair becomes a graph with no tooling to maintain

## Hard rules

1. **Draft before you interrogate** — one question, then a draft. Never open with a questionnaire
2. **Never more than 2 questions in one message** — and only about load-bearing blanks
3. **"I don't know" is handled, never punished** — offer 2-3 options with consequences and let the
   dev point. Never answer it with more questions
4. **Every guess is labelled `(guess)` — and listed back in chat** (Phase 3). The list is what the
   dev corrects; unlabelled invention breaks rule #6
5. **Never block on a blank section** — `_TBD — decide while building_` and move on
6. **What wasn't discussed or corrected = not in the plan** — a labelled guess the dev fixed or
   kept counts as discussed; silent additions never do
7. **Every output is a file** — not chat (so git can track it)
8. **Plan must have all eight sections** — `_TBD_` is a legitimate value, a missing heading is not
9. **Never overwrite an existing PLAN-<feature>.md** — check first, pick a different name
10. **A plan with an open run is live — add nothing to it that reads as work** (Phase 2). Park the
    new thing in its own plan and leave a one-line pointer naming the files this one doesn't touch
11. **Ordering and blockers go in frontmatter, not only in prose** — "ต้องอยู่ก่อน X" buried in
    paragraph 2 of a 40KB file is invisible to every later question about what to do next

## Piping into a non-MCP agent

This file is the prompt. Any agent that reads stdin can run it:

```bash
cat ~/.claude/skills/plan-with-pony/SKILL.md | claude -p
cat ~/.claude/skills/plan-with-pony/SKILL.md | opencode run
```
