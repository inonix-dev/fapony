---
kind: unit
status: blocked
blocked_by: waiting on the daily-digest wording from whoever owns support email
spec: SPEC-export.md
---

# PLAN-webapp-notifications — in-app + email notifications

> **Status:** ⏸ blocked · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** [SPEC-export.md](../spec/SPEC-export.md) (digest attachment format)

## TL;DR

- **What:** a bell menu for in-app events, plus one daily digest email
- **Why:** people find out a task was reassigned to them by accident, days later
- **Done when:** an assignment shows in the bell within 5s, and the digest arrives once a day
- **Order:** waits on `PLAN-feature-export.md` (the digest attaches its CSV)
- **Blocked because:** nobody has signed off the digest wording, and guessing it means writing
  the email twice — the code underneath is ready to start the day that lands
- **Progress:**
  - [ ] chunk 1 — event table + write path
  - [ ] chunk 2 — bell menu + unread count
  - [ ] chunk 3 — daily digest job

---

## 1. Goal (why)

Work gets assigned inside the app and announced nowhere. People discover it when they happen to
open the right page. Notifications close that gap without adding a second place to check.

## 2. Scope (do / don't do)

**Do:**
- In-app bell: assignment, mention, status change on something you own
- Unread count, mark-one-read, mark-all-read
- One daily digest email per user, with the day's events and a CSV attachment
- Per-user off switch for the digest

**Don't do:**
- No push notifications — browser permission prompts on first visit cost more than they give
- No per-event-type preference matrix — one switch until someone asks for more
- No SMS, no Slack, no webhooks

## 3. Done criteria (how we know it's finished)

- Assigning a task to someone puts an entry in their bell within 5 seconds
- Unread count matches the number of unread entries, and survives a reload
- The digest sends once per day per user, and never twice
- Turning the digest off stops it, verified with a second account
- `npm run typecheck` passes

## 4. Constraints / Hard rules (must not violate)

- Never notify someone about their own action
- The digest is idempotent — a retry must not send a second copy
- No notification body ever contains data the recipient cannot already see in the app
- Email failures never block the app write that caused them

## 5. Risks & Escape hatches (if it fails)

| Risk | Likelihood | Impact | Escape hatch |
|---|---|---|---|
| Digest double-sends on retry | medium | people stop trusting it | send-log row keyed by (user, date), written in the same transaction |
| Bell query slows the app shell | medium | every page feels slower | count-only query on load, list fetched when the menu opens |
| Wording lands late | high | this plan sits blocked | ship the bell alone; the digest is a separate chunk on purpose |

## 6. Steps (what in which order)

1. **Event table** — `notifications(user_id, kind, payload, read_at)` · verify: a migration runs clean on a copy of prod
2. **Write path** — one helper called from assignment/mention/status handlers · verify: integration test asserts one row per event, none for self-actions
3. **Bell UI** — count on the shell, list on open, mark-read · verify: two-account manual pass
4. **Digest job** — daily, idempotent, attaches the export CSV · verify: run twice, assert one email

## 7. Examples (make it concrete)

```
bell (3)
  @alice assigned you "Fix login bug"        2m ago
  @bob mentioned you in "Q4 planning"        1h ago
  "Add dark mode" moved to review            3h ago
```

## 8. References

- [PLAN-feature-export.md](PLAN-feature-export.md) — the CSV the digest attaches
- [SPEC-export.md](../spec/SPEC-export.md) — attachment format
- [templates/PLAN.md](../../templates/PLAN.md) — the template this follows
