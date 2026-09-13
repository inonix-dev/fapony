---
kind: unit
status: active
blocks: PLAN-webapp-notifications.md
spec: SPEC-export.md
---

# PLAN-feature-export — CSV/JSON export for data tables

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** [SPEC-export.md](../spec/SPEC-export.md)

## TL;DR

- **What:** an export button on every data table, writing CSV or JSON in the browser
- **Why:** people re-type table data into Excel by hand today, and lose columns doing it
- **Done when:** a filtered table exports a file Excel opens without mangling quotes or Thai text
- **Order:** blocks `PLAN-webapp-notifications.md` — the digest email attaches this exporter's output
- **Progress:**
  - [x] chunk 1 — `toCSV(rows, columns)` + escaper  `a1b2c3` 2026-09-06
  - [x] chunk 2 — `toJSON(rows, columns)`  `d4e5f6` 2026-09-06
  - [ ] chunk 3 — download trigger + dropdown on the table component
  - [ ] chunk 4 — edge cases: empty table, filtered rows, unicode

---

## 1. Goal (why)

People copy rows out of the UI table and paste them into Excel or Sheets. It is slow and lossy —
columns drop, long text wraps into the wrong cell. One button that downloads the same rows as a
real file removes the whole ritual.

## 2. Scope (do / don't do)

**Do:**
- Export button on the Tasks, Users and Projects tables
- Format picker (CSV or JSON) next to the button
- Export the *filtered* rows, not just the current page
- Filename from table name + date: `tasks-export-2026-09-05.csv`
- Browser download API — no backend involved

**Don't do:**
- No push to Google Sheets / Airtable — file download first, integrations later if anyone asks
- No scheduled exports — a click is the whole trigger
- No whole-database dump — only the table in front of the user
- No custom column picker — export the columns the table is showing

## 3. Done criteria (how we know it's finished)

- Click export → CSV → a file downloads
- That CSV opens in Excel with quotes and commas intact
- The JSON file parses with `jq` and is a valid array
- Filename matches `tasks-export-YYYY-MM-DD.csv`
- A filtered table exports only the filtered rows
- `npm run typecheck` passes

## 4. Constraints / Hard rules (must not violate)

- Nothing leaves the browser — no network request in the export path
- Empty table → button disabled with a "No data to export" tooltip, never a 0-byte file
- No CSV dependency — the fields are simple enough to escape in a few lines
- Never export a column the user has hidden

## 5. Risks & Escape hatches (if it fails)

| Risk | Likelihood | Impact | Escape hatch |
|---|---|---|---|
| Commas inside values break the CSV | medium | Excel reads the file wrong | quote every string field, always |
| 10k+ rows exhaust memory | low | tab crashes | chunk the download above 5k rows |
| Unicode lost (Thai text, emoji) | medium | file opens as mojibake | prepend a BOM and set `charset=utf-8` |

## 6. Steps (what in which order)

1. **CSV serializer** — `toCSV(rows, columns)` returns a string · verify: unit test over sample rows
2. **JSON serializer** — `toJSON(rows, columns)` · verify: unit test + `JSON.parse` round-trip
3. **Download trigger** — `createDownload(content, filename)` via Blob + `URL.createObjectURL` · verify: a file actually lands in Downloads
4. **UI** — export dropdown on the table component · verify: click, pick a format, file appears
5. **Edge cases** — empty, filtered, special characters · verify: three tests pass

## 7. Examples (make it concrete)

```bash
# filter the tasks table to status = in-progress, then export → CSV
head -3 tasks-export-2026-09-05.csv
# id,title,status,assignee
# 1,"Fix login bug",in-progress,"@delamind"
# 2,"Add dark mode",in-progress,"@alice"
```

Column mapping and the filename rules live in the spec — not here.

## 8. References

- [SPEC-export.md](../spec/SPEC-export.md) — column mapping + filename rules
- [templates/PLAN.md](../../templates/PLAN.md) — the template this follows
- [skill/plan-with-pony/SKILL.md](../../skill/plan-with-pony/SKILL.md) — how this plan was drafted
