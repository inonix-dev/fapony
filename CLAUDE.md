# fapony — Knowledge Base

## What is fapony

Measurement + verification layer for coding agents, shipped as an MCP server (`fapony mcp` — 8 tools, stdio JSON-RPC). No loop, no spawning, no executor role — fapony doesn't drive agents, it measures what already happened (git facts, session cost/tokens) and verifies claims against those facts. Any agent that speaks MCP can call it. อยู่นอก worktree ของ product เพราะ state ของผู้วัดไม่ควรอยู่ในที่ที่ผู้ถูกวัดแก้ได้

**North star:** ค่าที่ fapony ให้ได้จริงและ client เดี่ยว (OpenCode/ZCode/Claude Code/Codex) ให้ไม่ได้ คือ **`model × project × regime × quality` ข้าม run/client/project** — "งานแบบนี้ในโปรเจกต์นี้ ควรจ่ายให้ model ไหน" · session log ของทุกเจ้ามี token แต่ไม่มีเกรด, benchmark มีเกรดแต่ไม่ใช่โปรเจกต์คุณ — ต้องมี verdict + model + regime + token ครบสี่ในที่เดียวถึงจะถามได้ · **เคยเล็ง "project health / ไฟล์นี้เคยพัง" แล้วพลาด** — base rate ของ rework จริงคือ 1-9% ต่ำเกินจะเตือนอะไรได้ (ดูกฎ 8) `project_health_context` ยังอยู่แต่ไม่ใช่แกนอีกแล้ว fapony **ไม่ใช่** performance monitor รายวินาที — per-step timing/token/tool-latency มีอยู่แล้วใน session log ของแต่ละ client เอง (`fapony_usage` แค่ query field ที่มีอยู่แล้วให้สะดวกขึ้น ไม่ใช่จุดที่ fapony ได้เปรียบใครจริง)

**Runtime:** Bun-only, zero runtime dependency — ใช้แค่ `bun:sqlite`, `node:fs`, `node:child_process`
**State:** SQLite ที่ `~/.config/fapony/state.db` (WAL mode) — `FAPONY_STATE_DIR` env ย้ายได้
**Topology:** `fapony/` = main checkout (คุณแตะคนเดียว) · `fapony/cl-fapony/` = dev (clone คนละ `.git` — agents ทำงานที่นี่เท่านั้น) — clone อยู่ใน repo จึงต้อง gitignore `cl-*/` ก่อน
**License:** MIT, public ตั้งแต่ commit แรก

---

## Architecture

แผนที่ราย**ไฟล์** อยู่ที่ [docs/architecture.md](docs/architecture.md) — อ่านตอนหาที่วางโค้ดใหม่
ไม่ใช่ทุก session ระดับโฟลเดอร์พอสำหรับการรู้ว่าอะไรอยู่ไหน:

```
fapony.ts       CLI dispatch
skill/          <name>/SKILL.md — symlink เข้า client โดย `fapony install`
                (self-contained — link ออกนอก skill/<name>/ ตายตอน install)
templates/      PLAN.md / SPEC.md / mem/ — ของที่ `fapony init` วาง
src/db/         SQLite + config (store/load/getters/types/defaults)
src/session/    passive usage reader ราย client + activeSession (model attribution)
src/stats/      getStatsData() + format — KPI ข้าม run
src/report/     fapony report / report-web
src/usage/      fapony usage-web — อ่าน cache ไม่แตะ session log
src/context/    project-health block keyed by files[]
src/install/    หนึ่งไฟล์ต่อ client + skills.ts
src/mcp/        MCP server — transport (SERVER_INSTRUCTIONS), evidence allowlist, tools/ 8 ตัว
src/*.ts        gates · parse · memory · safety · math · init · init-mem · telemetry · setup · update · util · analyze
test/           หนึ่งไฟล์ต่อ src module + test/mcp/
```

---

## DB Schema (2 ตารางเท่านั้น ห้ามเพิ่ม)

```sql
runs(
  id INTEGER PRIMARY KEY,
  worktree TEXT NOT NULL,
  plan TEXT,
  mem_id TEXT,
  status TEXT NOT NULL,        -- running|awaiting_review|fixing|passed|stopped|stalled
  base_sha TEXT NOT NULL DEFAULT '',
  round INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)

events(
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,          -- spawn|gate|stop|memory_claim_closed|verification_report
  data TEXT                    -- json
)
```

**หลักคิด:** events คือ audit trail ที่เป็นข้อเท็จจริง (ไม่ใช่ transcript) — มาแทน "copy chat ทั้งหมด" · `runs` row = 1 measured/verified unit of work ที่ MCP client สร้างผ่าน `handoff_collect`, ไม่ใช่ 1 spawned execution loop

---

## Config Schema

ทุก field optional, `fapony.config.json` เองก็ optional (ไม่มีไฟล์ = ใช้ default ทั้งหมด) — ดู `src/db/types.ts` เป็น source of truth ตรง ๆ:

```json
{
  "worktrees": { "<key>": "<absolute-path>" },
  "review": { "maxRounds": 2 },
  "memory": {
    "claim": ["bun", ".fapony/.memory/mem.ts", "claim", "{id}"],
    "close": ["bun", ".fapony/.memory/mem.ts", "close", "{id}", "{msg}"],
    "add":   ["bun", ".fapony/.memory/mem.ts", "add", "{kind}", "{text}"],
    "kickoff": ["bun", ".fapony/.memory/mem.ts", "kickoff"]
  },
  "telemetry": { "enabled": false, "endpoint": "https://your-server/ingest" },
  "paths": { "stateDir": "~/.config/fapony", "planDir": ".fapony/plan", "doneDir": ".fapony/done", "specDir": ".fapony/spec", "memoryEntry": ".fapony/.memory/mem.ts" },
  "safety": { "deny": ["reset\\s+--hard", "clean\\s+-[a-z]*f", "checkout\\s+--\\s", "git\\s+stash"] },
  "usageWeb": { "port": 8080, "hostname": "127.0.0.1" }
}
```

- `review.maxRounds` — round cap read by the gate/stats logic (see Key Design Decisions #2 below) — the only surviving field of the old `review` block.
- `telemetry` — opt-in only (omit or `null` = off). ดู [TELEMETRY.md](TELEMETRY.md) ว่าส่งฟิลด์อะไรบ้าง (runs + event kind/timestamp เท่านั้น ไม่มี plan/commit/gate-note content)
- `memory: null` = ปิดทั้งชั้น (แต่ถ้า `.fapony/.memory/mem.ts` มีจริง → default-wiring ใช้ claim/close/add อัตโนมัติ)
- `usageWeb` — optional, `{ port, hostname }` for `fapony usage-web` defaults. `null` or omit = use defaults (port 8080, localhost). Run `fapony usage-scan` to populate data before opening the web view.
- env override: `FAPONY_CONFIG` (เลือกไฟล์ config), `FAPONY_STATE_DIR` (ย้าย state.db, ชนะ `paths.stateDir`)
- getters รวมศูนย์ใน `src/db/getters.ts` — ห้าม hardcode ค่า default ซ้ำที่ call site

---

## Key Design Decisions

### 1. ทำไม handoff ต้องเป็น structured facts ไม่ใช่ chat transcript

- Transcript ยาว = reviewer (คนหรือ agent) อ่านไม่หมด
- "typecheck ผ่านครบ" เป็นข้อมูลที่พิสูจน์แค่ว่าคอมไพล์ได้ ไม่ใช่ว่า flow หรือ permissions ถูก
- `handoff_collect` → `handoff_check` บังคับให้ claim ของ agent ถูกเทียบกับ git facts จริง ไม่ใช่เชื่อคำพูด
- git facts (files, commits) มาก่อนเสมอเพราะ verifiable; ส่วนที่ agent claim เอง (uncertain, not_done) ติดป้ายแยกชัดว่าพิสูจน์ไม่ได้

### 2. ทำไม cap 2 รอบ (`review.maxRounds`)

- Round 1: agent เขียน code, reviewer ตรวจ
- Round 2: agent แก้ตามที่ reviewer พบ
- Round 3 แปลว่า **plan** มีปัญหา ไม่ใช่โค้ดมีปัญหา → ต้องกลับหาคน เผา token แก้ symptom ไม่จบ

### 3. ทำไม fapony อยู่นอก worktree

- mem.ts ของ product = เกิดอะไรขึ้นกับ product (อยู่ใน git ของ product)
- fapony db = run ไหนถูกวัด/verify ผลอะไร (state ของผู้วัด ไม่ควรอยู่ในที่ที่ผู้ถูกวัดแก้ได้)
- fapony เรียก mem ผ่าน shell adapter ตาม config.memory.* ไม่ใช่ import โดยตรง

### 4. ทำไมใช้ SQLite สำหรับ run state

- bun:sqlite เป็น builtin = 0 dependency
- Run state ต้อง UPDATE (running → awaiting_review → fixing → passed) = append-only JSONL ทำได้แย่
- ถ้าใช้ JSONL ต้อง scan ทั้งไฟล์เพื่อ derive สถานะปัจจุบันทุกครั้ง

---

## Edge Cases ที่จัดการแล้ว

ย้ายไปที่ [docs/edge-cases.md](docs/edge-cases.md) — **`grep` ที่นั่นตอนเจอพฤติกรรมแปลก
ที่ดูเหมือนเคยเจอ** (ทุกแถวคือกับดักที่เคยเสียเวลาไปแล้วจริง) มันเป็น lookup ที่ 90% ของ
session ไม่ได้ใช้สักแถว เลยไม่ควรถูกจ่ายเข้า context ทุกครั้ง — กฎที่ต้องรู้ตลอดเวลา
อยู่ที่ *Rules for AI Agents* ด้านล่าง

---

## History

fapony started as an execute→review→fix CLI loop (`fapony run`/`loop`/`kickoff`/`gate`/`stop`/`handoff`/
`status`/`plan-mv`) that spawned executor/reviewer agents itself. That loop, and all the code behind it
(`src/run/`, `src/loop/`, `src/plans.ts`, `src/planmv.ts`, `src/status.ts`, `src/stop.ts`, `src/kickoff.ts`,
`src/handoff.ts`, `src/resilience.ts`, `src/sigint.ts`, `src/planlint.ts`), was deleted. fapony no longer
drives any agent — it's a measurement/verification layer any agent calls via MCP (see README.md). What's
left of that era: `runs`/`events` SQLite schema (repurposed — a run row is one measured/verified unit of
work, not one spawned loop iteration), `review.maxRounds` (still read as a cap signal), and the plan/spec
templates + `move-to-done`/`plan-with-pony` skills below (now agent-driven, not CLI-enforced).

---

## Rules for AI Agents

1. **ห้ามสร้าง abstraction ที่มี implementation เดียว** — ไม่ scaffold เผื่ออนาคต
2. **push ได้เฉพาะ branch ที่ทำงานอยู่ — ห้ามแตะ `main` ห้าม `--force`/`--force-with-lease`**
   เดิมห้าม push ทุกกรณี (ยกมาจาก vela opencode.json) ยกเลิกแล้วเพราะมันบล็อก `gh pr create`
   ซึ่งต้องมี branch บน remote ก่อน — กฎที่ต้องปลดล็อกทุกครั้งไม่ได้กันอะไร แค่สอนให้ข้าม ·
   สิ่งที่ทำลายได้จริงคือ force-push กับการเขียนทับ default branch ไม่ใช่ push เอง ·
   **merge เข้า `main` ยังเป็นของเจ้าของตัดสิน** agent เปิด PR ได้ กด merge เองไม่ได้
3. **Commit แยก concern** — one commit per feature/area
4. **assertSafe() ต้องเรียกกับทุก shell command** ที่ spawn จาก config (memory/evidence/install) รวมถึงที่มาจาก template
5. **fapony ห้ามเขียนไฟล์ใน worktree เป้าหมาย** — db อยู่ ~/.config/fapony/ เท่านั้น
6. **memory: null** = ปิดชั้น memory ทั้งหมด ไม่ error
7. **ให้เกรดทุกหน่วยงานที่จบ = ยิง `verdict_submit` เอง ไม่ต้องรอให้สั่ง** — มันคือ *เกรดของงาน*
   ไม่ใช่คำสารภาพ · **`regime` บังคับ** (`code | fix | review | plan`) ไม่ส่ง = call ถูก reject
   ตั้งใจให้ required เพราะ fill rate จริงในเครื่องนี้: required+enum (`reason_code`) = 50/50,
   optional (`files[]`) = 0 — **optional คือสิ่งที่ฆ่า fill rate ไม่ใช่การเพิ่ม field** ฉะนั้นงานที่ผ่านตั้งแต่รอบแรกก็ต้องบันทึก (เดิมกฎบอกไม่ต้อง — กลับด้านแล้ว
   เพราะค่าที่ใช้จริงย้ายจาก "ไฟล์นี้เคยพัง" ไปเป็น "model ไหนทำงานแบบไหนได้ดี" ซึ่ง n ต่อ model
   คือทุกอย่าง) · **1 run = 1 หน่วยงานที่วัดได้ ไม่ใช่ 1 plan** — bug ที่ไม่มี plan ก็เป็น run ได้
   (`plan` เป็น nullable ตั้งแต่ schema แรก และ null/not-null คือ A/B "ลุยเลย vs วางแผน" ที่ใช้จริง)
   · เจอว่าเดารอบแรกผิด ยิง `fail` ทันทีที่รู้ แล้วปิดด้วย pass-family เมื่อตรวจผ่านจริง
   (ตรวจไม่ได้ → `uncertain` ห้ามเดา pass) · `note` ต้อง standalone ห้ามอ้างอิงบทสนทนา
   · ห้ามทิ้ง run ค้าง — run ที่ไม่ terminal ดูด verdict อื่นของ worktree นั้นมาเกาะ
   ([store.ts findOpenRunWithNullPlan](src/db/store.ts))
   · **การ *ขอ* ไม่พอ — มี Stop hook บังคับแล้ว** ([src/hook.ts](src/hook.ts), ติดตั้งโดย
   `fapony install --platform claude`): จบเทิร์นที่มี commit แต่ไม่มี verdict = ถูก block
   หนึ่งครั้งพร้อมเหตุผล · hook **ไม่ตัดสินเกรดแทน** (มันไม่เห็นว่างานผ่านหรือพัง) —
   แยก "ใครตัดสิน" ออกจาก "ใครบังคับให้ตัดสิน" อันหลังเท่านั้นที่ automate ได้ ·
   สัญญาณคือ **commit ไม่ใช่ dirty tree** (dirty = กำลังทำอยู่, commit = หน่วยงานจบ) ·
   ทุกกรณีที่พิสูจน์ไม่ได้ (ไม่ใช่ git repo / ไม่มี transcript / hook ยิงไปแล้ว) = ปล่อยผ่าน
   hook ที่เดาผิดแล้วขัง agent แย่กว่าไม่มี hook
8. **`project_health_context` ไม่ใช่ reflex ก่อนแก้ไฟล์อีกแล้ว** — วัดกับ repo จริงแล้ว: ไฟล์ที่
   ship แล้วกลับมาโดน `fix:` ใน 14 วัน = 1% (canalis 66/8,760) / 9% (fapony 21/226) base rate
   ต่ำขนาดนี้แปลว่าเวลาจะแตะไฟล์หนึ่ง history แทบไม่มีอะไรจะเตือน · tool ยังอยู่ เรียกได้ถ้าอยาก
   แต่ **ห้ามบังคับ ห้ามเอากลับเข้า `SERVER_INSTRUCTIONS`** — ข้อความนั้นจ่ายทุก session ของทุกคน

---

## Memory: `.fapony/.memory/log.<คุณ>.jsonl` (append-only)

log ออกแบบให้เป็น **สมองส่วนกลางของโปรเจกต์** — วางไว้ในรีโป ไม่ใช่ใน
`~/.config/fapony/state.db` (ของเครื่องใครเครื่องมัน clone ไม่ติด) · ชื่อไฟล์มาจาก
`git config user.name` — คนละใบต่อคน จึงไม่มีอะไรให้ merge ชน ฉะนั้นถ้า repo ไหน commit มัน
`decision`/`bug`/`note` จะติดไปกับ clone ทันที

**แต่ "อยู่ในรีโป" ไม่เท่ากับ "อยู่ใน git" — ขึ้นกับ `.gitignore` ของแต่ละ repo และ
repo นี้จงใจไม่ commit:** `.gitignore` ที่นี่ ignore `.fapony/` ทั้งก้อน (public repo — mem/plan
เป็นบันทึกภายใน ไม่เอาขึ้น GitHub) ฉะนั้น**ในรีโปนี้ log อ่านได้จากเครื่องตัวเองเท่านั้น
ไม่ใช่ของที่แชร์ผ่าน clone** · ผลพลอยได้ที่ต้องรู้: `.fapony/evidence.json` ก็ไม่ถูก commit ด้วย
ทั้งที่กฎ evidence บอกว่าต้อง commit — ข้อยกเว้นนี้ใช้ได้เพราะที่นี่มีคนแก้คนเดียว
repo ที่มีหลายคนต้องเพิ่ม negation เอง (ดูตารางแถว `git mv` ด้านบน + README quick start)

**บันทึกระหว่างทำงาน ไม่ต้องรอให้สั่ง** — ไม่มีกลไกไหนเขียนให้ มีแต่ agent ที่รันเอง:

```bash
bun .fapony/.memory/mem.ts kickoff .fapony/plan/PLAN-x.md   # เปิด session ด้วยอันนี้
bun .fapony/.memory/mem.ts add decision "ตัดสินอะไร เพราะอะไร" .fapony/plan/PLAN-x.md
bun .fapony/.memory/mem.ts add bug "อะไรพัง"
bun .fapony/.memory/mem.ts add note "สถานะที่ session หน้าต้องรู้"
bun .fapony/.memory/mem.ts close <id> "แก้แล้ว <sha>"        # ปิด bug ที่แก้เสร็จ
bun .fapony/.memory/mem.ts find "usage-web"                  # grep text/spec
```

เขียนแต่ละแถวให้ **standalone** — มันถูกอ่านอีกทีในอีกหลายเดือนโดยไม่มีบทสนทนานี้ให้ย้อนดู ·
`close` เป็นตัวเดียวที่ปิด `bug` ไม่มีมัน list จะโตอย่างเดียว · `next`/`claim`/`synced`/`stale`
เลิกใช้แล้ว (ดู vela CLAUDE.md ว่าทำไม)

**ทำไมไม่ยัดกฎนี้ลง `SERVER_INSTRUCTIONS`:** mem.ts เป็นของ *โปรเจกต์* ไม่ใช่ของ fapony และมี
เฉพาะคนที่รัน `fapony init` · `SERVER_INSTRUCTIONS` จ่ายทุก session ของทุกคนที่ต่อ MCP —
คนส่วนใหญ่ไม่มีไฟล์นี้ ข้อความจะกลายเป็นคำสั่งให้รันคำสั่งที่พัง · habit นี้จึงอยู่ในไฟล์กฎของ repo
ที่มันมีจริง และ `fapony init` แค่**พิมพ์ snippet ให้ไปแปะ** ([src/init.ts](src/init.ts))

---

## Moat — สามข้อที่ต้องถืออย่างน้อยสอง

ภัยคุกคามที่ฆ่า fapony ได้จริงมีแบบเดียว: **client เจ้าของ model ทำเอง** (Claude Code/Cursor ออกฟีเจอร์
"จำสิ่งที่พังในโปรเจกต์นี้") — รูปเดียวกับที่ดูด execute→review loop ไปแล้วครั้งหนึ่ง ดู History

สิ่งที่กันได้มีสามอย่าง ทุกฟีเจอร์ต้องถืออย่างน้อยสองข้อ ถ้าข้อไหนก็ไม่ถือ = client เดียวก็ทำได้ = อย่าทำ:

1. **ข้ามไคลเอนต์** — ไม้บรรทัดเดียวกันทับ Claude Code + OpenCode (หลัก), ZCode (เสริม), Codex (ยังไม่ใช้จริง)
   session log ของแต่ละเจ้าไม่มีวันข้ามหากัน เพราะไม่มีใครได้ประโยชน์จากการทำให้ข้าม
2. **ข้ามโปรเจกต์** — `runs.worktree` เป็น key ตั้งแต่แรก dogfood ปัจจุบัน: `wt-fapony` → `wt-vela`
   (vela ใกล้เสร็จ ใช้ review-pony ทุกครั้ง แต่ยังไม่ค่อยมี plan — verdict ต้องทำงานได้โดยไม่มี plan ดูกฎ 7)
3. **เจ้าของถือข้อมูลเอง** — db อยู่ `~/.config/fapony/` เครื่องผู้ใช้ ไม่มี server ไม่มี account
   telemetry opt-in และ allowlist เท่านั้น

**ทีม = ฟีเจอร์เก็บเงินในอนาคต ยังไม่ทำ** public repo เล็งบุคคลล้วน เพราะคนเดียวได้ประโยชน์ตั้งแต่ verdict แรก
ส่วนทีมต้องมี shared ledger (จะเป็น hosted หรือให้เขา build server เอง ค่อยว่ากัน) และทีมที่ต้องการมัน
คือบริษัทที่จ่ายไหว — เขียนไว้เฉย ๆ อย่าเผลอสร้าง infra รอล่วงหน้า (ละเมิดกฎข้อ 1)

**แกนที่ลึกได้และไม่มีใครแตะ:** `model × project × regime × quality` — "ในโปรเจกต์นี้ งานแบบไหนควรจ่ายให้ model ไหน"
ต้องมี verdict + model + regime + token ครบสี่ในที่เดียวถึงจะถามได้ · session log มี token แต่ไม่มีเกรด ·
benchmark มีเกรดแต่ไม่ใช่โปรเจกต์คุณ · เคยเล็ง `failure-shape` แทน `regime` แล้วพลาด เพราะ base rate
ของความล้มเหลวจริงต่ำเกินไป (ดูกฎ 8)

**เรื่อง field ใหม่ — เคยสรุปผิด:** เดิมเขียนว่า "ทุก field ที่เพิ่ม ลด fill rate" ข้อมูลในเครื่องนี้บอกว่าไม่ใช่ —
`reason_code` (required + enum + reject) ได้ 50/50 ส่วน `files[]` (optional + คำอธิบาย passive) ได้ 0
**สิ่งที่ฆ่า fill rate คือ optional ไม่ใช่การเพิ่ม field** ฉะนั้นถ้าจะเพิ่มอะไรจริง ๆ ต้อง required + enum สั้น +
reject เมื่อไม่ส่ง — และยังต้องผ่านกฎข้อ 1 ว่าจำเป็นจริงก่อนอยู่ดี (`regime` ผ่านเพราะ derive ตอนอ่านไม่ได้
ส่วน token/plan-mode ไม่ต้องเพิ่ม field เลยเพราะ derive ได้)

## Positioning — กฎกันโดนถล่มตอนโปรโมท

เขียนไว้เพราะจะลืม ทุกครั้งที่เขียน README / โพสต์ / reply comment ให้ผ่านสี่ข้อนี้ก่อน:

1. **ห้ามใช้คำว่า "verifies" เป็นหัวเรื่อง** — `handoff_check` ตรวจ *conformance ของการรายงาน*
   (มี `## HANDOFF` ไหม, sha ที่อ้างอยู่ใน commit ไหม, กรอก `uncertain`/`not_done`/`checks` ครบไหม)
   ไม่ใช่พิสูจน์ว่าโค้ดทำงาน fapony ไม่รันเทสต์เอง ไม่ตัดสินเอง — มันคือ **ledger ไม่ใช่ judge**
   คนอ่าน HN เปิดซอร์สจริง พูดเกินคำเดียวเสียเครดิตทั้งโพสต์
2. **นำด้วย day-1 value เสมอ** — `usage-web` / `fapony_usage` ทำงานทันทีที่ติดตั้งเพราะอ่าน log
   ที่เขามีอยู่แล้ว ส่วน project health คือ **retention ไม่ใช่ acquisition** (`N=0 runs` ในนาทีแรก)
   ใครติดตั้งแล้วเจอ "ยังไม่มีประวัติพอ" เป็นอย่างแรก = ปิดทิ้ง
3. **ประกาศข้อจำกัดเองก่อนคนอื่นจับได้** — section "What fapony is not" ใน README ห้ามลบ
   สิ่งที่ยอมรับเองด้วยปากตัวเองไม่มีใครเอามาแฉได้
4. **cross-client คือจุดต่าง ไม่ใช่ตัว dashboard** — tool อ่าน usage ของ Claude Code มีเยอะแล้ว
   ที่อ่าน 4 client บนไม้บรรทัดเดียวกันแทบไม่มี ย้ำตรงนั้น

**เกณฑ์ว่าพร้อมโปรโมท:** คนที่ไม่ใช่เจ้าของติดตั้งแล้วเห็นอะไรที่มีประโยชน์ภายใน 60 วินาที
— ไม่ใช่จำนวน feature · ลำดับช่อง: awesome-mcp-servers PR → r/ClaudeAI + ชุมชนไทย →
บทความ *"I built the agent loop everyone builds first, then deleted it"* (ดู History ด้านบน) →
Show HN **นัดเดียว อย่าเผา**

## Plan Core — template สำหรับทุก plan

ใช้ [templates/PLAN.md](templates/PLAN.md) กับทุก plan file (ไม่ใช่แค่ fapony) — copy ไปตั้งชื่อ
`.fapony/plan/PLAN-<feature>.md` และ [templates/SPEC.md](templates/SPEC.md) กับทุก spec file
(`.fapony/spec/SPEC-<feature>.md`) **กฎเหล็ก 4 ข้อ** (บังคับ ไม่ใช่แนะนำ): section 1–4 ห้ามขาด (ไม่งั้น plan
ไม่บรรลุนิติภาวะ ไม่ให้ agent ทำ) · section 6 แต่ละขั้นต้อง verify ได้ · section 8 ต้อง link กลับ · **plan =
what/why/order, spec = how in detail** — ห้ามแปะ API shape/schema/wireframe/edge-case ลงใน plan section 7
ตรงๆ ให้ link ไปที่ spec แทน

**Frontmatter + TL;DR (เพิ่ม 2026-09-13):** หัวไฟล์มี `kind`/`status`/`blocked_by`/`blocks`/
`superseded_by`/`spec` (ค่าเป็น EN เสมอ — เป็น enum ที่ tool อ่าน) แล้วตามด้วย `## TL;DR` ≤15 บรรทัด
ที่เป็น**ส่วนเดียวที่เปลี่ยนได้ระหว่างทำงาน** (ติ๊ก checkbox + แปะ sha) — ทำให้ "สถานะตอนนี้" อ่านได้จาก
40 บรรทัดแรกแทนที่จะดูดทั้งไฟล์ 140KB เข้า context · `plan_list` นับ checkbox ของ **section `##` แรก
เท่านั้น** (ไม่ผูกกับคำว่า TL;DR จึงใช้ได้ทุกภาษา) และ render เป็น master checklist ได้ — **ห้ามสร้างไฟล์
MASTER.md** ทุกบรรทัดของมัน derive จาก frontmatter + checkbox อยู่แล้ว ไฟล์ที่ maintain เองจะตกรุ่นเสมอ

**Layout `.fapony/{plan,done,spec}` (2026-09-13):** `done/` อยู่**ข้าง ๆ** `plan/` ไม่ใช่ข้างใน —
ไฟล์ที่ archive จึงลึกเท่าเดิม ลิงก์ relative ในไฟล์ (`../spec/...`) รอดทั้งหมด การ archive เหลือ `git mv`
ชื่อเดิม + sed ลิงก์ plan→plan เท่านั้น (กฎ normalize link หายไปทั้งข้อ) · **ไม่เติมวันที่หน้าชื่อไฟล์** —
วันที่อยู่ใน header `> ✅ **shipped YYYY-MM-DD**` อยู่แล้ว เอามาแปะชื่อไฟล์อีก = เก็บค่าเดียวกันสองที่
เพื่อให้ `ls` เรียงได้ แลกกับการต้องแก้ inbound link ทุกครั้งที่ ship ตลอดไป — "วันนั้นจบอะไร" ให้ derive
(`grep -h shipped .fapony/done/*.md | sort`) · **spec ไม่ archive เลย** ไม่มี `spec/done/` เพราะ spec คือ
ห้องสมุด ("ของนี้ทำงานยังไง" ถูกถามหลัง ship นานหลายเดือน) และ spec ที่ไม่ย้าย = ลิงก์ที่ไม่พัง ·
`paths.doneDir` default `.fapony/done` · `plan_list` fallback ไปอ่าน `plan/done/` ถ้า `done/` ไม่มี
(repo เก่าจะได้ไม่เห็นเลข archive เป็น 0 เงียบ ๆ)

**Layout `.fapony/.memory` (2026-09-13):** ของทุกอย่างของ fapony อยู่ใต้ `.fapony/` ที่เดียว —
memory log default คือ `<project>/.fapony/.memory/log.jsonl` (monorepo: `<app>/.fapony/.memory/`)
fallback ไป `.memory/` เดิมเมื่อมี `log.jsonl` อยู่ที่นั่นจริง (repo เก่าทำงานต่อได้ตลอดไป ไม่มีแผนลบ
fallback) · **ไม่เปลี่ยนชื่อ `.memory`** แค่ย้ายที่ · ชื่อโฟลเดอร์รวม app ไม่ hardcode `apps/` อีกแล้ว
(`apps` → `packages` → `services` ตัวแรกที่มีจริง) · `paths.memoryEntry` ที่ประกาศไว้ยังชนะ default
เสมอ และห้ามเพิ่ม config field ใหม่ (derive จากโครงสร้าง เหมือนที่ `plan/done` ทำ)

Spec link กลับหา plan ด้วย (`> **Used by:** [PLAN-x.md](...)`) — ทำให้เป็น graph สองทาง ไม่ต้องมี tooling
เพิ่ม แค่ markdown link ที่ skill `move-to-done` เดินหา inbound link ด้วย grep เอง (ไม่มี CLI enforcement
แล้ว — ดู History ด้านบน)

---

## CLI Commands

```bash
fapony mcp                          # MCP server — stdio JSON-RPC, 8 tools
fapony hook-stop                    # Claude Code Stop hook (stdin JSON) — blocks a turn that has ungraded commits
fapony report <run-id>              # verification report for a run
fapony report-web [file]            # static HTML report page
fapony usage-scan                    # scan session logs → usage-cache.jsonl (incremental, progress bar)
fapony usage-web [port]              # live usage comparison dashboard from cache (no session log access)
fapony stats                        # KPIs: pass/stall rate, by-model, by-grade
fapony init <path>                  # scaffold .fapony/ (plan/spec/memory/evidence.json)
fapony init-mem [--update]          # re-copy templates/mem/ into this repo's memory dir (path from paths.memoryEntry) — data files (log.jsonl) untouched
fapony install --platform opencode|claude|zcode|codex  # wire mcp.fapony into an MCP client (+ symlink skills for claude/opencode)
fapony setup                        # interactive wizard: config + scaffold in one step
fapony update                       # self-update via git pull
fapony telemetry show|send          # opt-in only, default off — see TELEMETRY.md
fapony test                         # self-check
fapony analyze [path]               # structural diagnosis (hub/orphan/cycle/changed-untested) — live graph via Bun.Transpiler.scan(), never persisted (no table: 114 files / 466 imports = 16.6ms, cache would be pure debt)
```

<!-- code-review-graph MCP tools -->
## MCP Tools: fapony

fapony ships an MCP server (`fapony mcp`) — stdio JSON-RPC, zero runtime dependency. 8 tools:

| Tool | Purpose |
|------|---------|
| `plan_list` | Pending plan files grouped by state (`active` / `blocked` / `untouched` / `superseded` / `trackers`) + progress tally, joined with run history — not a raw `ls`. State comes from optional 4-key frontmatter; `format:"markdown"` renders the generated master checklist |
| `handoff_collect` | Get machine facts from git (diff stat, commits, branch) |
| `handoff_check` | Verify handoff conformance against facts |
| `verdict_submit` | Store a 6-grade verdict (pass-excellent → uncertain) + required `regime` (`code\|fix\|review\|plan`) — the task-shape axis |
| `fapony_stats` | Query KPIs: by-model (gates/fails/quality/tokens), by-grade, **planned vs dove-in** (`runs.plan` null/not-null), **regime × model**; `group_by: reason_code\|plan` for top-N slices |
| `fapony_usage` | Query passive usage from OpenCode, ZCode, Claude Code, and Codex sessions (tokens, cost, by-model; `detail:true` adds per-step timing) |
| `verification_report` | Full verification report: facts + checks + evidence + verdict, duration, rounds |
| `project_health_context` | Known-patterns block keyed by `files[]` — recurring fail reasons, escalations, round-1-pass shapes. Pre-edit reflex for any task; `plan-with-pony` is one caller, not the only one |

See [docs/mcp-handcheck.md](docs/mcp-handcheck.md) for full protocol, adapter examples, and safety rules.

## MCP Tools: code-review-graph

**This project has a knowledge graph. When the code-review-graph MCP tools are available in your
client, start with them to narrow scope, then read the source.** The graph is cheaper than
scanning files and gives you structural context (callers, dependents, test coverage) that file
search cannot.

**Check first — the tools are not always wired here.** The graph itself is always current: a
pre-commit hook (`.git/hooks/pre-commit`, installed by code-review-graph) runs
`code-review-graph update` on every commit. The *MCP server* is a per-client registration, and
in Claude Code it is currently registered for other projects, not this one — so the tool names
below may simply not exist in your session. If they don't, the `code-review-graph` CLI is on
PATH, and reading the source directly is always a valid fallback. An absent tool is not a
reason to stop; it is a reason to skip the graph step.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph updates on every commit (pre-commit hook), not on every file write — a graph read mid-edit reflects the last commit, not your unstaged changes.
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
