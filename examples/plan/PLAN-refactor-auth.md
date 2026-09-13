---
kind: tracker
---

# PLAN-refactor-auth — auth hardening tracker

> **Status:** 📋 tracker — this file never "finishes" · **Owner:** delamind · **Created:** 2026-09-05

## TL;DR

- **What:** the running list of auth work, split into plans as each piece becomes real
- **Why:** auth changes arrive one incident at a time; a single plan would never close
- **Done when:** never — `kind: tracker` keeps this out of the backlog count
- **Progress:**
  - [x] session cookie flags (`SameSite`, `Secure`, `HttpOnly`)  `9f8e7d` 2026-08-30
  - [x] password reset token single-use  `1a2b3c` 2026-09-02
  - [ ] move refresh tokens out of localStorage — needs its own plan
  - [ ] rate-limit the login endpoint — needs its own plan
  - [ ] audit log for privilege changes

---

## Why this is a tracker, not a plan

A plan is one unit of work: it has a done criterion and it ends. This file is a **place to keep
the next auth thing** so it is not lost between incidents. `plan_list` reports it under
`trackers`, separately from the backlog, because counting it as pending work would mean the
backlog can never reach zero.

When an item here becomes real, it graduates: draft `PLAN-auth-<thing>.md` with the full eight
sections, link it from the line below, and tick the line when that plan ships.

## 1. Goal (why)

Keep auth improvements visible between the incidents that motivate them.

## 2. Scope (do / don't do)

**Do:** hold items, link out to the plan that does each one
**Don't do:** implement anything directly from this file — a tracker has no done criteria, so
nothing here is verifiable on its own

## 8. References

- [templates/PLAN.md](../../templates/PLAN.md) — the template a graduated item follows
- [skill/plan-with-pony/SKILL.md](../../skill/plan-with-pony/SKILL.md) — drafting the real plan
