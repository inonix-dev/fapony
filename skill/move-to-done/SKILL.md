---
name: move-to-done
description: Move a shipped PLAN to .fapony/done/. Trigger on /move-to-done and when the user asks to archive a completed plan.
---

# Move to Done — archive PLAN after ship

You are about to move a PLAN that has been shipped to the archive.

## Rules

0. **Report in lines, not paragraphs** — what moved, what the inbound-link sweep found, what
   needs the user. Never narrate the steps; the commands are already in the transcript.

1. **PLAN must have shipped header** — regex: `^> ✅ \*\*.*shipped.*\*\*$`
   If missing, add it yourself, don't ask — invoking this skill *is* the ship claim (the user
   has already verified the work landed; this step is paperwork). Replace the plan's
   status/header line with `> ✅ **shipped <YYYY-MM-DD>** (<hash>)` — today's date plus
   `git rev-parse --short HEAD`. The date is load-bearing: it is the *only* record of when this
   shipped that a later question can read, since the filename does not carry one.
   Say in the summary that you stamped it, so a wrong HEAD is visible and correctable.
   STOP only if there's no git repo / no commits to hash from.

1b. **A plan can also leave `plan/` without shipping** — it got absorbed into another plan, or the
   redesign deleted the thing it planned. That is normal during a UI/UX sweep and is the main
   reason `plan/` grows forever: there is no state for "dead" so it just sits there. Archive it
   the same way, with two differences — header `> ⛔ **superseded by [PLAN-bar.md](PLAN-bar.md)**
   (<date>)` instead of the shipped header, and frontmatter on the successor's side left alone
   while this file gets:
   ```yaml
   status: superseded
   superseded_by: PLAN-bar.md
   ```
   Then skip step 5 — no work shipped, so there is no verdict to record. Never archive a plan as
   superseded on your own reading; the user says which plan replaced it.

   A plan that is merely *waiting* (on a person, a customer, a decision) is **not** dead and does
   not move — mark it `status: blocked` + `blocked_by: <what you are waiting for>` and leave it in
   `plan/`, where `plan_list` will report it as blocked instead of as backlog.

2. **Run `plan-sweep --apply`** — this does the `git mv`, rewrites markdown links inside the
   file and inbound links from other plan files, warns about plain-text mentions, and logs
   a decision row — all in one call:
   ```bash
   fapony mem plan-sweep <PLAN-foo.md> --apply
   ```
   It refuses if the file lacks a shipped header or has open mem rows (next/bug/hold/decision/note).
   If git refuses ("not under version control" — `.fapony/` is gitignored in this repo), plain
   `mv` instead; there's nothing to commit for an untracked path, so skip step 4 in that case.
   The filename gets no date prefix — the ship date is already in the header (step 1).

3. **Leave the spec where it is** — `.fapony/spec/` is a reference library, not a queue. A spec
   answers "how does this work", which is asked long after the plan that ordered it shipped, and
   a spec that never moves is a link that never breaks. Nothing to do here; there is no
   `spec/done/`.

4. **Commit split by concern** (only when the moved files are actually tracked by git):
   ```
   chore(plan): archive PLAN-foo.md (shipped <hash>)
   ```

5. **Record the verdict** — call the `verdict_submit` MCP tool (fapony) so this ship counts
   toward what this project knows about the model that did the work. No `run_id` needed:
   - `verdict`: `pass` (adjust if the ship had known rough edges — see VERDICT_GRADES)
   - `regime`: **required** — the shape of the work that shipped: `code` for a feature or
     refactor, `fix` for a bug fix, `plan` when what shipped was the plan or spec itself
   - `reason_code`: **`none` when the ship was clean** — not `other`. `other` means "a real
     problem none of the buckets name", so a clean ship filed there shows up in the
     recurring-fail-reasons list and crowds out the reasons that mean something. Otherwise
     `missing_test` / `scope_mismatch` / `unsafe_command` / `spec_gap` / `incomplete`, and
     `other` (with a `note`, which it requires) only when a real finding fits none of them
   - `note`: **omit it on a clean ship.** A verdict with no note still counts toward the plan
     history future drafts read ("passed round 1 before"), but only notes carry prose forward — so
     "clean ship" evicts a note that would have taught the next session something. Write one only when this plan hit something a
     reader could not get from the diff: what the symptom looked like, where the cause actually
     was, and the rule that follows. Standalone prose — it is read months later with no access
     to this conversation.
   - `worktree`: **absolute path** to this repo/worktree (`git rev-parse --show-toplevel`) —
     every other fapony tool and query scopes by
     absolute path too; a bare repo name won't match them
   - `plan`: the archived plan's path (post-move, e.g. `.fapony/done/PLAN-foo.md`)
   - `files`: repo-relative paths this plan touched (`git diff --name-only <base>..HEAD`) —
     the only input to per-file risk history; without it the verdict says something happened
     but not where
   Skip only if fapony's MCP tools aren't available in this session — don't block the archive on it.

## Example

```
Input: .fapony/plan/PLAN-kickoff.md, no shipped header yet
Steps:
1. stamp header: > ✅ **shipped 2026-09-13** (a1b2c3)
2. fapony mem plan-sweep .fapony/plan/PLAN-kickoff.md --apply
   → moved, links rewritten, decision logged
3. spec: untouched, stays in .fapony/spec/
4. commit
5. verdict_submit(verdict="pass", reason_code="none", regime="code", worktree="/Users/you/Project/fapony/wt-fapony", plan=".fapony/done/PLAN-kickoff.md", files=["src/kickoff.ts"])
   — clean ship, so no note
```

A ship worth a note looks like this instead:

```
5. verdict_submit(verdict="pass-adequate", reason_code="spec_gap", regime="fix",
     note="sheet scroll reset on open, not close — the restore hook was on the wrong side; the router's own scrollRestoration resets on every navigate(). Check the router option before writing a restore hook.",
     worktree="/Users/you/Project/vela", plan=".fapony/done/PLAN-quick-nav.md",
     files=["src/routes/expenses/index.tsx"])
```

## If fail

- No git repo / no commits (can't derive a shipped hash) → tell user: "Add header > ✅ **shipped** (<hash>) first"
- Stamped the header yourself → always say which hash you used
- plan-sweep refuses (open mem rows) → close them or use `MEM_FORCE=1`
- Too many inbound links → plan-sweep reports them; too many to fix → report the list
