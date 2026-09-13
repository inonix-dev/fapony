---
kind: unit
---

# PLAN-fix-race-condition — double-submit on the checkout button

> ✅ **shipped 2026-09-08** (`7c4d9a1`)
> **Owner:** delamind · **Created:** 2026-09-05
>
> **This file is the archive example.** It lives in `done/`, which sits *beside* `plan/` rather
> than inside it — so archiving was a plain `git mv` with the same filename at the same depth,
> and the relative links below still resolve. The ship date is in the header above, not in the
> filename: `grep -h shipped done/*.md | sort` answers "what landed when" without anyone paying
> to rewrite inbound links on every ship.

## TL;DR

- **What:** one click on Checkout, one order — the button submitted twice under a slow network
- **Why:** three duplicate orders in a week, each one a manual refund
- **Done when:** rapid double-clicks produce exactly one order row
- **Progress:**
  - [x] chunk 1 — disable the button while the request is in flight  `3b1f0c` 2026-09-07
  - [x] chunk 2 — idempotency key on the order endpoint  `7c4d9a1` 2026-09-08

---

## 1. Goal (why)

Two clicks 300ms apart created two orders. The UI guard alone would have been a race with the
network; the server needed to refuse the second write as well.

## 2. Scope (do / don't do)

**Do:** in-flight guard on the button, idempotency key accepted and enforced by the order endpoint
**Don't do:** no global request deduplication layer — this is one endpoint with one real problem

## 3. Done criteria (how we know it's finished)

- Ten rapid clicks produce one order row
- A replayed request with the same key returns the original order, not a new one
- A different key still creates a new order
- `npm run typecheck` passes

## 4. Constraints / Hard rules (must not violate)

- The UI guard alone is not a fix — the server must hold the invariant
- Keys expire (24h); an idempotency table that grows forever is a second bug

## 5. Risks & Escape hatches (if it fails)

| Risk | Likelihood | Impact | Escape hatch |
|---|---|---|---|
| Key collision across users | low | wrong order returned | key is (user_id, client_key), unique together |
| Button stays disabled after a failed request | medium | user cannot retry | re-enable in a `finally`, not on success |

## 6. Steps (what in which order)

1. **UI guard** — disable while in flight, re-enable in `finally` · verify: manual double-click
2. **Idempotency key** — client generates, server stores with a unique constraint · verify: replay test returns the same order id

## 7. Examples (make it concrete)

```
POST /orders  Idempotency-Key: 9f2c…  → 201 order_id=1043
POST /orders  Idempotency-Key: 9f2c…  → 200 order_id=1043   (replay, no new row)
```

## 8. References

- [plan/PLAN-feature-export.md](../plan/PLAN-feature-export.md) — unrelated, linked to show a
  `done/` → `plan/` link still resolving after the move
- [templates/PLAN.md](../../templates/PLAN.md) — the template this follows
