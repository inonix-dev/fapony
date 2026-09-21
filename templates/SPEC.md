# Spec Core — template for every spec file

> Use with [PLAN.md](PLAN.md). A spec holds the **detail** a plan should only
> link to: API/data shapes, schemas, wireframes, edge cases, examples. Put it
> in `.fapony/spec/<feature>.md`.

```markdown
# SPEC-<feature>.md — <short name>

> **Used by:** [PLAN-<feature>.md](../plan/PLAN-<feature>.md)
> (add every plan that references this spec — keeps the link bidirectional so
> either file leads you to the other, and `fapony plan-mv` finds this file
> when it scans inbound links.)

---

## Non-goals
What this explicitly does **not** do, one line of why each. Widening scope is an
agent's default; a spec that only says what to build never stopped anything.

## Shape (data / API / schema)
Concrete types, request/response bodies, DB columns — whatever the code needs.

## Edge cases
Three columns: input → expected → **verify** (a command that actually runs).
An edge case with no check after it is an opinion, not a requirement — and a
verify built from a substring of the prose is not a verify (real case: `grep "sed"`
matched "superseded", so the check passed while the work was missing).

## Examples
Before / after, request / response, sample payloads — as long as it needs to be.
```

**Rule:** a plan's section 7 (Examples) links here instead of pasting content.
If a plan keeps growing, the fix is usually "move it into the spec", not
"trim the plan" — the detail is still needed, just not in the file an agent
re-reads every round.
