# fapony — Knowledge Base

## What is fapony

**ความจำความเจ็บของโปรเจกต์ สำหรับทีมที่เขียนโค้ดด้วย agent** — mem log (`.jsonl` ในรีโป)
+ convention debt (`fapony debt`) + lint baseline บวกเครื่องอ่าน usage ที่บอกว่าแต่ละอย่าง
กิน token เท่าไหร่ · ส่งเป็น MCP server (`fapony mcp` — stdio JSON-RPC) agent ไหนก็เรียกได้

**North star:** **agent ไม่มีความเจ็บสะสม — มันจึงไม่เคยสร้าง abstraction เอง**
ทุก session มันเกิดใหม่ เขียน `try/catch` ครั้งที่ 37 ด้วยความสดชื่นเท่าครั้งแรก ส่วน wrapper
อย่าง `failWith` / `BaseInitClass` เกิดจาก *คน* ที่เจ็บซ้ำจนจำได้ · fapony คือสิ่งเดียวในห้องที่
จำแทนได้ งานของมันคือ **จำความเจ็บ → บอกว่าเมื่อไหร่ควรมีของกลาง → ตามว่าย้ายไปถึงไหนแล้ว**

**หน่วยของคุณค่าคือ token ไม่ใช่คุณภาพ** (ปรับ 2026-09-19 — ดู "ทำไมแกนย้าย") — คนที่เจ็บจริง
คือคนที่**จ่ายค่า plan เอง** ไม่ใช่ dev ที่ใช้งบบริษัท ฉะนั้นทุกฟีเจอร์ต้องตอบได้ว่า
**"ประหยัด token ไปกี่ตัว"** ไม่ใช่ "โค้ดดีขึ้นแค่ไหน" — อันหลังพิสูจน์ไม่ได้และไม่มีใครจ่ายเงินให้
· ตัวอย่างที่วัดแล้ว: `review-seed --files` 5 ไฟล์ 2,146 บรรทัด = 3.7KB (~940 tokens)
เทียบกับอ่านทั้ง 5 ไฟล์ ~35k tokens

**สิ่งที่ *ไม่ใช่* งานของ fapony: หา dead code / โค้ดซ้ำ** — knip / madge / dependency-cruiser /
jscpd เก่งกว่า · **knip คือ `checker` ไม่ใช่คู่แข่ง** — `debt.ts` มีกฎเหล็กว่า `checker != null`
= fapony ไม่รายงานซ้ำ ฉะนั้น dead export / barrel ให้ผูกเป็น `"checker"` ของ convention นั้น
ไม่ใช่เขียน detector ใหม่ · ช่องที่ว่างจริงคือ **layer 3: "ไฟล์ไหนยังไม่ย้าย"** — eslint บอกว่า
บรรทัดนี้ผิด, CLAUDE.md บอกว่ากฎคืออะไร, **ไม่มีใครบอกว่าตัดสินใจไปเมื่อ 6 เดือนก่อนแล้วย้ายไป
11 จาก 47**

---

## ทำไมแกนย้ายจาก ledger มาเป็น mem + debt (2026-09-19)

fapony เริ่มจาก mem log `.jsonl` แล้วเดินไปทาง ledger (ให้ agent เกรดงานตัวเอง) ซึ่ง
**ทำให้เห็นภาพได้จริงและคุ้มที่ทำ** — แต่วัดแล้วมันตันด้วยสามอย่าง:

1. **self-grading bias ไม่ใช่ค่าคงที่ — มันต่างกันรายโมเดล** เพราะแต่ละ model เกรดงานของตัวเอง
   ฉะนั้น `claude-opus-5 q3.6` vs `deepseek-v4.1-flash q4.0` (regime=code, n=18/n=10)
   **อธิบายได้ทั้งหมดด้วย "opus เข้มกับตัวเองกว่า"** โดยคุณภาพจริงไม่ต่างเลย · ranking รอด
   bias ที่คงที่ ไม่รอด bias ที่ต่างรายตัว → **ห้ามอ้าง cross-model quality ranking เป็นข้อเท็จจริง**
2. **grade เฟ้อ** — 340 จาก 360 gate เป็น pass-family, fail-family ทั้งหมด **24 แถว** all-time
   ข้ามทุกโปรเจกต์ · denominator ขนาดนี้รองรับ per-file mechanic อะไรไม่ได้เลย (559 distinct files)
3. **ตลาดของมันแคบกว่าที่คิด** — "model ไหนคุ้มกว่า" เจ็บเฉพาะคนจ่ายเอง ส่วน dev ที่ใช้
   Max plan ของบริษัทไม่มีเหตุผลจะวัด

**สิ่งที่รอดจากการวัดครั้งนี้คือ token** — มันมาจาก session log ไม่ได้มาจากคำประกาศของ agent
ฉะนั้นมันโกงไม่ได้ · **เส้นแบ่งความน่าเชื่อถือใหม่ ใช้ตัดสินทุกฟีเจอร์:**

| เชื่อได้ | เชื่อไม่ได้ |
| --- | --- |
| token / cost จาก session log · git facts (commit, files, sha) · ผลรัน checker (eslint/knip/tsc) · regex match ของ debt | เกรดที่ agent ให้ตัวเอง · "typecheck ผ่านครบ" ที่ไม่มี exit code · คำว่า "แก้แล้ว" |

**ledger ไม่ถูกลบ — มันถูกแช่แข็งและเปลี่ยนหน้าที่เป็น *เซนเซอร์ความเจ็บ*:** `verdict` ที่เป็น
fail/`scope_mismatch`/`spec_gap` พร้อม `files[]` + `note` คือ input ของการหาโซนที่เจ็บซ้ำ ·
ส่วนที่ยังใช้ได้เต็มปากคือ **token ต่องาน** (วัดได้) และ **`files[]` + `note`** (ข้อเท็จจริง
ที่ agent พิมพ์ ไม่ใช่การตัดสิน) — **ไม่ใช่ตัวเกรด**

**อ่าน fail 24 แถวแล้วได้บทเรียนที่เปลี่ยนเป้า:** ส่วนใหญ่ไม่ใช่ "ไม่รู้" แต่เป็น
**"ไม่ได้ตรวจ"** — *"Round 1 fixed the symptom, not the cause"* · *"reported done, but never
ran the FULL bun test suite"* · *"reported all 4 findings fixed but only 2 of 4 actually
verified"* · *"Plan is entirely stale"* · ฉะนั้น mem ที่มีค่าที่สุดไม่ใช่ "ไฟล์นี้เคยพังยังไง"
แต่เป็น **"ครั้งก่อนตรวจไม่ครบตรงไหน"**

---

## สามชั้น และเส้นที่ห้ามปนกัน

| | **core — mem + debt** | **usage — วันแรก** | **ledger — แช่แข็ง** |
| --- | --- | --- | --- |
| โค้ด | `src/memory.ts` `src/debt/` `src/lint-baseline.ts` `src/adapters/mcp/tools/mem.ts` `src/init-mem.ts` | `src/session/` `src/usage/` `src/digest/` | `src/db/` (เหลือแค่ store) `src/stats/` `src/report/` `src/context/` |
| เขียนอะไร | `.jsonl` ในรีโปที่วัด (ของทีม) | อ่านอย่างเดียว (cache) | 1 graded row ลง `~/.config/fapony/state.db` |
| สถานะ | ที่ที่งานใหม่ไปลง | ที่มาของ day-1 value | **ไม่รับฟีเจอร์ใหม่** — แก้ได้เฉพาะบั๊ก |
| ถ้าลบทิ้ง | ไม่เหลือ fapony | คนติดตั้งเห็น N=0 แล้วปิดทิ้ง | core ยังตอบได้ทุกข้อ |

**กฎที่ตามมา:**
1. **ledger ห้ามเป็นเงื่อนไขของ core และกลับกัน** — `fapony debt` / `mem_find` ต้องทำงานได้
   โดยไม่มี `state.db` ·
2. **ห้ามให้ ledger เขียนลง worktree** — เคยมีข้อเสนอให้ `verdict_submit` เขียน mem row
   อัตโนมัติ **ปฏิเสธแล้ว**: มันบังคับให้เส้นทางที่ร้อนที่สุด spawn shell จาก config และพัง
   เมื่อไม่มี `.fapony/` · ที่สำคัญกว่า — mem row มีค่าเพราะเป็นร้อยแก้ว standalone ที่คนหรือ
   agent ตั้งใจเขียน ไม่ใช่ log ที่ถูก generate
3. **ฟีเจอร์ใหม่ต้องมีเจ้าของชั้นเดียว** ถ้าเขียนแล้วไม่รู้ว่าอยู่ชั้นไหน = ยังไม่เข้าใจปัญหาพอ

**Runtime:** Bun-only · dep ใหม่ต้อง `await import()` ในเส้นทางที่ใช้จริง — `fapony mcp`
ถูกสตาร์ททุก session ของทุก client และ `fapony.ts` static-import ทุก module
เช็ค: initialize round trip ≤ ~100ms (วัด 63ms · `require("typescript")` เดี่ยว ๆ = 92ms
คือทำพังได้ด้วย dep เดียว)
**State:** SQLite ที่ `~/.config/fapony/state.db` (WAL) — `FAPONY_STATE_DIR` ย้ายได้ ·
`read-track/<session>.jsonl` ใน stateDir เดียวกันคือ log ของ read hint (ต่อ session ทิ้งได้)
**Topology:** `Project/fapony/` เป็นโฟลเดอร์เปล่าที่อุ้มสองรีโปเป็นพี่น้องกัน —
`fapony/fapony/` = main checkout (เจ้าของแตะคนเดียว) · `fapony/cl-fapony/` = dev
(clone คนละ `.git` — agent ทำงานที่นี่เท่านั้น) · **พ่อแม่ต้องไม่มี `CLAUDE.md`** ไม่งั้น
agent ที่เปิดใน `cl-fapony/` โหลดไฟล์เดียวกันสองรอบ (นี่คือเหตุผลที่แยกออกมา 2026-09-20)
**License:** MIT, public ตั้งแต่ commit แรก

---

## Architecture

แผนที่ราย**ไฟล์**อยู่ที่ [docs/architecture.md](docs/architecture.md) — อ่านตอนหาที่วางโค้ดใหม่
ไม่ใช่ทุก session:

```
fapony.ts       7-line dispatch → src/adapters/cli.ts
src/mem/        fapony mem <add|close|find|kickoff|done|stale|claim|release|synced|plan-sweep|plan-check|rotate>
src/memory.ts   shell adapter + config (mem-log reader อยู่ src/core/mem-log.ts)
src/core/       pure layer — config/types/pricing/safety/parse/format/debt-*/enums/hint-log/hook-helpers (ห้าม import กลับ features/adapters/db-store)
src/adapters/   cli.ts + hooks/ (stop/read-hint/edit-hint/session-start) + mcp/ (transport, evidence allowlist, 3 tools)
src/hook.ts     shim re-export → src/adapters/hooks/ (ยังมี importer จริง อย่าลบ)
src/debt/       fapony debt — layer 3 "ไฟล์ไหนยังไม่ย้าย" (live, ไม่ persist)
src/lint-baseline.ts  แยก "แดงอยู่ก่อนแล้ว" ออกจาก "ฉันทำให้แดง"
src/conventions-seed.ts  fill-signal ตอน init — wrapper detector อ่าน snapshot ไม่แตะ history
src/map.ts      extractExports/extractBody (parse gate ฉีดได้ผ่าน ExportScanner, default Bun.Transpiler)
src/seed/       plan-seed · review-seed (lookup ตอน execute)
src/session/    passive usage reader ราย client + activeSession
src/usage/      fapony usage-web — อ่าน cache ไม่แตะ session log
src/digest/     fapony digest — รวม mem log, plans, usage cache, verdicts หน้าเดียว
src/install/    หนึ่งไฟล์ต่อ client + skills.ts
src/db/ (store เท่านั้น) · src/stats/ src/report/ src/context/   ← ledger (แช่แข็ง)
src/*.ts        gates · math · init · init-mem · telemetry · setup · update · analyze · price/ · web/
                (parse/safety/util ที่ root คือ shim → core อย่าแก้ผิดก๊อปปี้)
skill/          <name>/SKILL.md — symlink เข้า client โดย `fapony install`
templates/      PLAN.md / SPEC.md — ของที่ `fapony init` วาง
test/           หนึ่งไฟล์ต่อ src module + test/mcp/ · test/install/ · test/telemetry/
```

---

## Client support — อะไรใช้ได้กับใคร (ปรับ 2026-09-21)

`fapony install` รู้จัก 5 ไคลเอนต์ · **MCP เป็นชิ้นเดียวที่ทุกตัวได้** · hook/hint เป็นรายไคลเอนต์
และ **ลำดับยิงต่างกัน** — Claude Code ยิง *ก่อน* tool call (`PreToolUse` → `additionalContext`)
ส่วน OpenCode ยิง *หลัง* (`tool.execute.after` — ช่อง annotate เดียวที่มี ต้อง mutate
`output.output` ห้าม throw เพราะจะ block tool) ฉะนั้น OpenCode เห็นคำเตือนช้ากว่าหนึ่ง step

| | claude | opencode | cursor | zcode | codex |
| --- | --- | --- | --- | --- | --- |
| MCP 3 tools | ✅ | ✅ | ✅ | ✅ | ✅ |
| Stop hook (ไม่จบเทิร์นที่มี commit แต่ไม่มี mem row ใหม่) | ✅ | — | ✅ | — | ✅ after trust |
| Read hint (ไฟล์ใหญ่ + debt/mem) | ✅ ก่อน | ✅ หลัง | — | — | — |
| Re-read hint (อ่านซ้ำไฟล์เดิม mtime ไม่ขยับ) | ✅ ก่อน | ✅ หลัง | — | — | — |
| Edit hint (จำนวน importer ก่อนแก้ shape) | ✅ ก่อน | ✅ หลัง (edit+write) | — | — | — |
| Commit hint (`git commit` → เตือน mem row) | — | ✅ หลัง | — | — | — |
| SessionStart (ยิง `mem kickoff` เป็น context) | ✅ | ✅ ครั้งแรกที่ dispatch | — | — | ✅ after trust |
| Skill symlink → `~/.claude/skills` | ✅ | ✅ | — | — | — |
| Skill symlink → `~/.agents/skills` | — | — | — | ✅ | ✅ |
| `usage-scan` อ่าน session log ของเจ้านั้น | ✅ | ✅ | — | ✅ | ✅ |

`—` = ยังไม่ต่อ ไม่ใช่ทำไม่ได้ (Cursor ไม่มี PreToolUse · ZCode/Codex ไม่มี in-process hook surface
สำหรับ read/edit hints — Codex `apply_patch` ส่ง patch text ไม่ใช่ file path) · **ทำไม hint อยู่บน hook ไม่ใช่
MCP** — มันต้องยิงกลางเทิร์นเองโดย agent ไม่ต้องนึก ตรงเกณฑ์ MCP-vs-CLI (กฎ 13) เป๊ะ · **commit hint
มีแต่ OpenCode** เพราะ Claude ใช้ Stop hook รายงาน commit ที่ยังไม่มี mem row แทน · Codex hooks ต้อง
trust ผ่าน `/hooks` ก่อน run — `fapony install` บอกเมื่อต้องทำ · **SessionStart บน OpenCode มาตอน
dispatch ครั้งแรก** (`experimental.chat.system.transform` ครั้งเดียวต่อ session — ช่อง inject เดียวที่
`event` hook ไม่มี) ไม่ใช่ตอนสร้าง session · ตัวติดตั้ง **ไม่เคยเขียนทับ plugin ของตัวเอง**
ฉะนั้นแก้ `*PluginSource` แล้วต้องลบไฟล์ใน `~/.config/opencode/plugins/` ทิ้งก่อน install ใหม่ ไม่งั้นได้ของเก่าเงียบ ๆ

## Memory: `.fapony/.memory/log.<คุณ>.jsonl` (append-only)

**นี่คือแกน** — log ออกแบบให้เป็นสมองส่วนกลางของโปรเจกต์ วางในรีโป ไม่ใช่ใน `state.db`
(ของเครื่องใครเครื่องมัน clone ไม่ติด) · ชื่อไฟล์มาจาก `git config user.name` — คนละใบต่อคน
จึงไม่มีอะไรให้ merge ชน ฉะนั้นรีโปที่ commit มัน `decision`/`bug`/`note` จะติดไปกับ clone ทันที

**บันทึกระหว่างทำงาน ไม่ต้องรอให้สั่ง** — ไม่มีกลไกไหนเขียนให้ มีแต่ agent ที่รันเอง:

```bash
fapony mem kickoff .fapony/plan/PLAN-x.md   # เปิด session ด้วยอันนี้
fapony mem add decision "ตัดสินอะไร เพราะอะไร" --files a.ts,b.ts
fapony mem add bug "อะไรพัง" --files a.ts
fapony mem add note "สถานะที่ session หน้าต้องรู้"
fapony mem close <id> "แก้แล้ว <sha>"
fapony mem find "usage-web"
```

- **`--files` สำคัญที่สุด** — ไม่มีมัน แถวนั้นตกพื้นตอน cluster หาโซนที่เจ็บซ้ำ · รีโปที่ log
  เก่าไม่รู้จัก `--files` ให้ `fapony init-mem` ครั้งเดียว **ก่อน**จะสรุปอะไรจาก log
  (วัดแล้ว: vela มี 2,672 แถว แต่ `files[]` ศูนย์แถว เพราะเหตุนี้)
- เขียนแต่ละแถวให้ **standalone** — ถูกอ่านอีกทีในอีกหลายเดือนโดยไม่มีบทสนทนานี้
- `close` เป็นตัวเดียวที่ปิด `bug` ไม่มีมัน list จะโตอย่างเดียว
- **kind ทั้งหมดยังใช้จริง ไม่มี deprecated** — `decision`/`bug`/`note` agent เลือกเอง ส่วน
  `next`/`hold`/`claim`/`release`/`synced`/`stale` เป็น bookkeeping ของ `mem.ts` เอง
- **อ่านกลับผ่าน MCP `mem_find`** (`files[]`/`text`/`kind`/`since`/`limit` — ไม่มี default filter)
- **หน่วยของ cluster คือ *โซน* ไม่ใช่ไฟล์** และต้องนับ **1 แถว = 1 เหตุการณ์** — เคยนับ
  file-hit แล้วได้ `layouts/quick 10×` ซึ่งเฟ้อ (verdict เดียวแตะ 9 ไฟล์ถูกนับ 9) นับใหม่เหลือ
  `server/services` 6× · `server/routes/v1` 6× และมีโซน ≥5 hits แค่ **2 โซน**
  `(แก้ 2026-09-19 หลังวัดซ้ำด้วย .fapony/plan/pain-cluster.ts)`

**`.gitignore` ของรีโปนี้ ignore `.fapony/` ทั้งก้อน** (public repo — mem/plan เป็นบันทึกภายใน)
ฉะนั้นที่นี่ log อ่านได้จากเครื่องตัวเองเท่านั้น ไม่ใช่ของที่แชร์ผ่าน clone · `.fapony/evidence.json`
ก็ไม่ถูก commit ด้วย ทั้งที่กฎ evidence บอกว่าต้อง commit — ข้อยกเว้นนี้ใช้ได้เพราะที่นี่มีคนแก้
คนเดียว repo ที่มีหลายคนต้องเพิ่ม negation เอง

**ทำไมไม่ยัดกฎนี้ลง `SERVER_INSTRUCTIONS`:** mem.ts เป็นของ *โปรเจกต์* ไม่ใช่ของ fapony
และมีเฉพาะคนที่รัน `fapony init` · `SERVER_INSTRUCTIONS` จ่ายทุก session ของทุกคนที่ต่อ MCP
— คนส่วนใหญ่ไม่มีไฟล์นี้ ข้อความจะกลายเป็นคำสั่งให้รันคำสั่งที่พัง

---

## Convention debt — `fapony debt`

layer 3 ที่ไม่มีใครตอบ: *"ตัดสินใจไปเมื่อ 6 เดือนก่อน แล้วย้ายไปถึงไหนแล้ว"*

- นิยาม convention อยู่ใน**รีโปที่วัด** (`<repo>/.fapony/conventions.json` — resolver เดียวกับ
  mem log) — **fapony ไม่รู้จัก React หรือ Hono และต้องไม่รู้**
- 1 convention = pattern ที่ควรใช้ (ok) + pattern ที่แปลว่ายังไม่ย้าย (stale) + scope (where)
  + เงื่อนไขไฟล์ (guard)
- **กฎเหล็ก: `checker != null` = fapony เงียบ** รายงานซ้ำกับ eslint คือ abstraction ที่มี
  implementation เดียว และสอนให้ agent ข้ามทั้งคู่
- คำนวณสดทุกครั้ง ไม่เขียนลงไหนเลย (เหมือน `analyze` — cache คือหนี้ล้วน ๆ list ที่แช่แข็ง
  จะตกรุ่นเงียบ ๆ แบบ MASTER.md)
- cap: stale regex ที่ match เกิน 250 ไฟล์ = regex พัง ไม่ใช่ convention → drop แล้วบอกตรง ๆ

`fapony lint-baseline` เป็นคู่ของมัน: แยก "แดงอยู่ก่อนแล้ว" ออกจาก "agent ทำให้แดง" โดย
เทียบ `path:rule-id` (ไม่ใช่เลขบรรทัด — บรรทัดเลื่อนทุกครั้งที่แก้ไฟล์) ที่ base_sha ·
report only ไม่เคย block · **นี่คือรูปธรรมของ "ประหยัด token"**: agent ที่ไม่เห็น baseline
จะ `fix all` ก่อน แล้วงานจริงจมอยู่ใน diff ก้อนเดียว (ของจริงจากเจ้าของ: *"138 spots
across ~40 files unrelated to the work"*)

---

## DB Schema (2 ตารางเท่านั้น ห้ามเพิ่ม)

ledger แช่แข็งแล้ว — schema นี้อยู่เพื่อความเข้ากันได้ ไม่ใช่เพื่อขยายต่อ:

```sql
runs(id, worktree, plan, mem_id, status, base_sha, round, created_at, updated_at)
events(id, run_id, ts, kind, data)   -- kind: spawn|gate|stop|memory_claim_closed|verification_report
```

`runs` row = 1 measured unit of work ที่ `verdict_submit` สร้างเมื่อไม่มี run เปิดค้าง ·
events คือ audit trail ที่เป็นข้อเท็จจริง ไม่ใช่ transcript

---

## Config Schema

ทุก field optional, `fapony.config.json` เองก็ optional — ดู `src/core/config.ts` เป็น source of truth:

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

- `memory: null` = ปิดทั้งชั้น ไม่ error
- `telemetry` — opt-in only (omit หรือ `null` = ปิด) ดู [TELEMETRY.md](TELEMETRY.md)
- env override: `FAPONY_CONFIG` · `FAPONY_STATE_DIR` (ชนะ `paths.stateDir`) ·
  `FAPONY_NO_REREAD_HINT=1` (kill switch ของ re-read hint — ไม่ยิงและไม่เขียน log)
- getters รวมศูนย์ใน `src/core/config.ts` — ห้าม hardcode default ซ้ำที่ call site
- **ห้ามเพิ่ม config field ใหม่ถ้า derive จากโครงสร้างได้** (`plan/done` กับ `.memory` ทำแบบนี้แล้ว)

---

## Edge Cases ที่จัดการแล้ว

ย้ายไปที่ [docs/edge-cases.md](docs/edge-cases.md) — **`grep` ที่นั่นตอนเจอพฤติกรรมแปลกที่
ดูเหมือนเคยเจอ** (ทุกแถวคือกับดักที่เคยเสียเวลาไปแล้วจริง) เป็น lookup ที่ 90% ของ session
ไม่ได้ใช้ เลยไม่ควรถูกจ่ายเข้า context ทุกครั้ง

---

## History

fapony เริ่มจาก execute→review→fix CLI loop ที่ spawn executor/reviewer เอง — ลบทิ้งทั้งหมด
(`src/run/`, `src/loop/`, `src/plans.ts`, `src/handoff.ts`, ...) เพราะ client เจ้าของ model
ทำเองได้ดีกว่า · จากนั้นแกนย้ายไป ledger (ให้ agent เกรดงานตัวเอง) ซึ่งตอบคำถามของมันจบแล้ว
และ**ตัน**ด้วยสามเหตุผลข้างบน · แกนวันนี้คือ mem + debt ซึ่งบังเอิญเป็นจุดที่ fapony เริ่มต้น
(mem log `.jsonl`) — ที่เหลือจากสองยุคนั้น: schema `runs`/`events`, `review.maxRounds`,
plan/spec templates, และ skill ทั้งหมด

**บทเรียนที่ต้องไม่ลืม: ทั้งสองครั้งที่แกนย้าย เกิดจากการวัด ไม่ใช่จากความรู้สึก**

---

## Rules for AI Agents

1. **ห้ามสร้าง abstraction ที่มี implementation เดียว** — ไม่ scaffold เผื่ออนาคต
2. **วัดก่อนสร้าง — ทุกครั้ง** รีโปนี้กลับคำเพราะตัวเลข 4 ครั้งแล้ว (`files[]` fill rate ที่เชื่อว่า 0
   แต่จริง 88% · zone cluster ของ vela ที่เฟ้อจาก file-hit · self-grading bias · line count ตอน
   คิดจะเปิดรีโปใหม่) **ทั้งสี่ครั้งความเชื่อเดิมผิด** · ถามหา base rate ก่อนเขียน detector เสมอ —
   1-9% ฆ่าฟีเจอร์เตือนรายไฟล์มาแล้ว
3. **push ได้เฉพาะ branch ที่ทำงานอยู่ — ห้ามแตะ `main` ห้าม `--force`/`--force-with-lease`**
   agent เปิด PR ได้ กด merge เองไม่ได้
4. **Commit แยก concern** — one commit per feature/area · **งานที่จบแล้ว commit เลย ห้ามถามก่อน**
   · **จบ = typecheck ผ่าน + `bun fapony.ts test` ผ่าน** ถ้ายังไม่ผ่านคือยังไม่จบ อย่า commit ทับ
5. **assertSafe() ต้องเรียกกับทุก shell command** ที่ spawn จาก config (memory/evidence/install)
   รวมถึงที่มาจาก template
6. **fapony เขียนไฟล์ในเวิร์กทรีเป้าหมายได้ ถ้าเจ้าของสั่ง** — แทนด้วยสามข้อที่เช็คได้:
   - **6a runtime state ห้ามอยู่ในเวิร์กทรี** — `state.db` อยู่ `~/.config/fapony/` เท่านั้น
     (mem log เป็นคนละเรื่อง มันคือ *ของทีม* จึงต้องอยู่ในรีโป) · เช็ค: path ของ db ห้ามมาจาก
     arg/config ที่ชี้เวิร์กทรี
   - **6b คำสั่งที่อ่านโค้ด ห้ามมี write side effect** — `analyze` `debt` `lint-baseline`
     `review-seed` `stats` `digest` `report` เขียนได้เฉพาะ path ที่ผู้ใช้ชี้เอง (`--out` /
     ชื่อไฟล์ใน argv) · คำสั่งใหม่ที่อ่านโค้ดตกอยู่ใต้ข้อนี้อัตโนมัติ
   - **6c เขียนทับของที่มีอยู่ = ถามก่อน หรือปฏิเสธ** — **consent ไม่ใช่ prohibition**
7. **บันทึก mem ระหว่างทำงาน พร้อม `--files` เสมอ** — นี่คือกฎที่แทนกฎ "ยิง verdict ทุกครั้ง"
   ในฐานะ habit หลัก · เขียน `decision` ตอนตัดสินใจอะไรที่ session หน้าจะงง, `bug` ตอนเจอของพัง,
   `note` ตอนจบ chunk · แถวที่ไม่มี `--files` ตกพื้นตอน cluster = เขียนไปเท่ากับไม่ได้เขียน
8. **Stop hook บังคับ mem row** ([src/hook.ts](src/hook.ts) — shim, logic อยู่ `src/adapters/hooks/`): จบเทิร์นที่มี commit แต่
   ไม่มี mem row ใหม่ = ถูก block หนึ่งครั้ง · ไม่มี mem log เลย = ไม่ block ·
   `verdict_submit` ถอดออกจาก MCP แล้ว (PLAN-verdict-to-mem) — engine อยู่ใน git
   ฟื้นเป็น CLI ได้ · hook ไม่ตัดสินเกรดแทน — แยก "ใครตัดสิน" ออกจาก
   "ใครบังคับให้บันทึก" อันหลังเท่านั้นที่ automate ได้
9. **การ *ขอ* ไม่ได้ผล การ *บังคับ* ได้ผล** — วัดแล้วมีสองอย่างที่เปลี่ยนพฤติกรรมจริง:
   required + enum + reject (`regime`) กับ Stop hook · ทุกอย่างที่เขียนว่า "ควรทำ" ในไฟล์กฎ
   ไม่มีผลวัดได้ · **ฉะนั้นฟีเจอร์ที่พึ่ง "agent จะจำไปทำเอง" = ยังไม่เสร็จ**
10. **`project_health_context` ไม่ใช่ reflex ก่อนแก้ไฟล์** — base rate ของ rework จริงคือ
    1% (canalis) / 9% (fapony) ต่ำเกินจะเตือนอะไรได้ · tool ยังอยู่ เรียกได้ถ้าอยาก แต่
    **ห้ามบังคับ ห้ามเอากลับเข้า `SERVER_INSTRUCTIONS`**
11. **Execute plan ทีละ chunk ห้ามลากยาวเป็น session เดียว** — context ใน session เดียวมีแต่โต
    ไม่เคยหด (วัดจริง: session 300-500 steps ลาก token สูงกว่า session สั้นอย่างไม่เป็นสัดส่วน
     กับงานที่ทำ) จบ 1 chunk: ติ๊ก checkbox + stamp TL;DR → commit แยก →
     `mem.ts add note "สิ่งที่ chunk ถัดไปต้องรู้" --files f1,f2 <path/to/PLAN-x.md>` (path ต้อง
    พิมพ์เหมือนเดิมทุกครั้ง — `kickoff` เทียบ string ตรงตัว) → **หยุด** · session ถัดไปเปิดด้วย
    `mem.ts kickoff <path เดิม>` แทนแบก transcript เก่า
12. **ฟีเจอร์ที่ไม่มี caller = ลบ** — ทำจริงแล้ว: `fapony map` ไม่มี caller, `plan-seed` §2/§5
    วัดได้ 3/3 ว่าง → −257 บรรทัด · ของฝั่งอำนวยความสะดวกพิสูจน์ตัวเองด้วยการถูกใช้
    ไม่ใช่ด้วยการมีอยู่
13. **จ่าย token อย่างฉลาด — ไม่ใช่ "ตัดให้น้อยที่สุด" แต่ "จ่ายตรงที่ได้คืน"**
    ถ้าไม่จ่ายเลย agent ก็ไม่รู้อะไรเลย และ **ข้อมูลที่ agent ไม่รู้ = ข้อมูลที่ไม่มี** ·
    สิ่งที่ agent รู้ทุกครั้งคือ **input token** ซึ่งถูกกว่า **output token** ที่มันจะเผาไป
    เดา/อ่านทั้งไฟล์/แก้ผิดแล้วแก้ใหม่ · ฉะนั้นเกณฑ์ไม่ใช่ "ใหญ่ไหม" แต่คือ **"จ่าย input เท่านี้
    แล้วประหยัด output ได้มากกว่าไหม"** (ของจริง: `review-seed --files` จ่าย ~940 → เลี่ยง ~35k)
    - **MCP vs CLI ตัดกันตรงนี้:** schema ใน `tools/list` เป็น **ค่าเช่าคงที่** จ่ายทุก session
      ของทุก client แม้ไม่เรียกสักครั้ง ส่วน CLI เป็น **0 จนกว่าจะรัน** · ฉะนั้น
       **สิ่งที่คนสั่งให้ทำ = CLI · สิ่งที่ agent ต้องนึกได้เองกลางเทิร์นโดยไม่มีใครสั่ง = MCP** ·
       `mem_find` ผ่านข้อนี้ ส่วน `fapony_stats` ไม่ผ่านเพราะคนเป็นคนถามเสมอ
    - **เก็บให้พอ ไม่ใช่อธิบายให้เยอะ** — field ที่ต้องเขียนคำอธิบายสามย่อหน้าแปลว่ายังไม่รู้ว่า
      จะเก็บอะไร · **ถ้าสรุปด้วยประโยคเดียวไม่ได้ แปลว่ายังไม่เข้าใจปัญหาพอ** (รูปเดียวกับกฎ 3)
    - description เขียนแบบ **สั่ง ไม่ใช่โน้มน้าว** — "ส่งอันนี้มาด้วย" สั้นกว่าและได้ผลเท่ากับ
      ย่อหน้าที่อธิบายว่าทำไมมันสำคัญ (กฎ 9: การขอไม่ได้ผล สิ่งที่ได้ผลคือ required + enum + reject)
    - **เกณฑ์ตัดสินตอนจะเพิ่ม tool ใหม่:** agent จะเรียกมันเองกลางงานไหม ถ้าคำตอบคือ
      "เรียกเมื่อเจ้าของสั่ง" = CLI · ถ้าตอบไม่ได้ = ยังไม่ต้องเพิ่ม


---

## Moat — สามข้อที่ต้องถืออย่างน้อยสอง

ภัยคุกคามที่ฆ่า fapony ได้จริงมีแบบเดียว: **client เจ้าของ model ทำเอง** — รูปเดียวกับที่ดูด
execute→review loop ไปแล้วครั้งหนึ่ง ดู History

1. **ข้ามไคลเอนต์** — ไม้บรรทัดเดียวกันทับ Claude Code + OpenCode (หลัก), ZCode, Codex
   session log ของแต่ละเจ้าไม่มีวันข้ามหากัน เพราะไม่มีใครได้ประโยชน์จากการทำให้ข้าม ·
   `src/session/` 2,450 บรรทัดคือ moat ข้อนี้ทั้งดุ้น และเป็นของที่เขียนใหม่แพงที่สุด
2. **ข้ามโปรเจกต์ / ข้ามเครื่อง** — `runs.worktree` เป็น key ตั้งแต่แรก · mem log อยู่ในรีโป
   จึงข้ามเครื่องได้ฟรีผ่าน git อยู่แล้ว
3. **เจ้าของถือข้อมูลเอง** — db อยู่ `~/.config/fapony/` เครื่องผู้ใช้ ไม่มี server ไม่มี account
   telemetry opt-in และ allowlist เท่านั้น

ทุกฟีเจอร์ต้องถืออย่างน้อยสองข้อ ถ้าข้อไหนก็ไม่ถือ = client เดียวก็ทำได้ = อย่าทำ

**เรื่อง field ใหม่ — สรุปผิดมาสองรอบ อย่าสรุปรอบสาม:** รอบแรก "ทุก field ที่เพิ่ม ลด fill rate"
(ผิด) รอบสอง "**optional** คือสิ่งที่ฆ่า fill rate" (ผิดอีก — `files[]` ยัง optional
ทุกตัวอักษรแต่ fill rate 294/333 = 88%) · **ที่ยังจริง:** กฎข้อ 1 (ต้องพิสูจน์ว่าจำเป็น) และ
required + enum + reject เป็นเครื่องมือที่แรงที่สุด · **ส่วน *ทำไม* fill rate มันพลิกคืน 09-11
ข้อมูลแยกไม่ออก อย่าเขียนว่ารู้** — มีของเปลี่ยนสามอย่างในหน้าต่างเดียวกัน และแถวแรกที่มี
`files[]` มาก่อน merge commit ราวหนึ่งชั่วโมง · **correlation วันเดียวกันไม่ใช่สาเหตุ**

---

## Cloud — รายได้อนาคต ยังไม่สร้าง

**ทิศที่มองไว้:** sync ราคาถูกข้ามเครื่อง เพราะรูปแบบการทำงานกำลังเปลี่ยน — สั่งงานผ่าน
Telegram/iPad แล้วเปิดคอมที่บ้านรัน agent ไว้ · คนสั่งไม่ได้นั่งอยู่หน้าโค้ด agent จำไม่ได้
ก็พลาดซ้ำ แล้วจบด้วยการเรียก model ตัวใหญ่มา scan + refactor 20 ไฟล์ — **ความเจ็บที่ mem + debt
เล็งอยู่ตรง ๆ และวัดเป็น token ได้**

**สัญญาณราคา:** ถาม dev ที่รู้จักเรื่อง $5/seat ได้คำตอบว่า *"ถ้าทำให้ไม่ต้องมา refactor
20 ไฟล์ซ้ำ ๆ ก็จ่ายได้"* — **นี่คือ n=1 และเป็นคำพูด ไม่ใช่การจ่ายเงิน** อย่าอ้างเป็น validation

**กฎกันสร้าง infra ล่วงหน้า (กฎ 1):**
- **เกณฑ์เริ่มงาน cloud: มีคนที่ไม่ใช่เจ้าของใช้ fapony ต่อเนื่องเกิน 30 วัน** ก่อนหน้านั้น
  sync คือ infra สำหรับ user คนเดียว = abstraction ที่มี implementation เดียว
- **คนเดียวหลายเครื่องไม่ต้องใช้ cloud** — mem log อยู่ในรีโป (git พาไปเอง) และ `state.db`
  เป็นไฟล์เดียว (private repo / Syncthing / iCloud พอ) · cloud จำเป็นจริงตอน ledger + mem
  **ข้ามคน** เท่านั้น
- **วันที่มี cloud โปรโมทข้อ 3 ของ Moat จะตาย** ("db อยู่เครื่องคุณ ไม่มี server ไม่มี account")
  ต้องได้อะไรที่ใหญ่กว่ามาแลก และต้องมี self-host option ไม่งั้นเหลือ moat แค่สองข้อ

---

## Positioning — กฎกันโดนถล่มตอนโปรโมท

1. **ห้ามใช้คำว่า "verifies" เป็นหัวเรื่อง** — fapony ไม่รันเทสต์เอง ไม่ตัดสินเอง
   มันคือ **ที่จำ ไม่ใช่ผู้ตัดสิน** คนอ่าน HN เปิดซอร์สจริง พูดเกินคำเดียวเสียเครดิตทั้งโพสต์
2. **ห้ามอ้างว่า fapony บอกได้ว่า model ไหนเก่งกว่า** — self-grading bias ต่างกันรายโมเดล
   (ดู "ทำไมแกนย้าย") · ที่พูดได้คือ **token ต่องาน** ซึ่งวัดจาก log
3. **นำด้วย day-1 value เสมอ** — `usage-scan` / `usage-web` (CLI) ทำงานทันทีที่ติดตั้งเพราะอ่าน log
   ที่เขามีอยู่แล้ว ส่วน mem + debt คือ **retention ไม่ใช่ acquisition** (ต้องสะสมก่อนถึงมีค่า) ·
   **ห้ามสลับลำดับ README ให้ mem/debt ขึ้นก่อน จนกว่าจะมีเลข moved% สองจุดเวลา** — ใครติดตั้ง
   แล้วเจอ "ยังไม่มีประวัติพอ" เป็นอย่างแรก = ปิดทิ้ง (นี่คือสิ่งที่ฆ่า `project_health_context`)
4. **ประกาศข้อจำกัดเองก่อนคนอื่นจับได้** — section "What fapony is not" ใน README ห้ามลบ
5. **ห้ามขายว่า "fapony หา dead code / โค้ดซ้ำให้"** — knip / madge / jscpd ฟรีและเก่งกว่า
   คนอ่านคนแรกจะตอบว่า "ก็ knip ไง" · ประโยคที่ขายได้คือ **"agent จำความเจ็บไม่ได้ จึงไม่เคย
   สร้าง abstraction — fapony จำแทน แล้วบอกว่าย้ายไปถึงไหนแล้ว"**
6. **cross-client คือจุดต่าง ไม่ใช่ตัว dashboard** — tool อ่าน usage ของ Claude Code มีเยอะแล้ว
   ที่อ่าน 4 client บนไม้บรรทัดเดียวกันแทบไม่มี

**กลุ่มเป้าหมายคือคนที่จ่ายค่า plan เอง** — dev ที่ใช้ Max plan ของบริษัทไม่เจ็บ จึงไม่ใช่ลูกค้า
ทุกข้อความต้องพูดกับคนที่บริหาร token อยู่

**เกณฑ์ว่าพร้อมโปรโมท:** คนที่ไม่ใช่เจ้าของติดตั้งแล้วเห็นอะไรที่มีประโยชน์ภายใน 60 วินาที
— ไม่ใช่จำนวน feature · ลำดับช่อง: awesome-mcp-servers PR → r/ClaudeAI + ชุมชนไทย →
บทความ *"I built the agent loop everyone builds first, then deleted it"* → Show HN
**นัดเดียว อย่าเผา**

---

## Plan Core — template สำหรับทุก plan

ใช้ [templates/PLAN.md](templates/PLAN.md) (`.fapony/plan/PLAN-<feature>.md`) และ
[templates/SPEC.md](templates/SPEC.md) (`.fapony/spec/SPEC-<feature>.md`) · **กฎเหล็ก 4 ข้อ:**
section 1–4 ห้ามขาด · section 6 แต่ละขั้นต้อง verify ได้ · section 8 ต้อง link กลับ ·
**plan = what/why/order, spec = how in detail** — ห้ามแปะ API shape/schema/edge-case ลงใน
plan section 7 ตรง ๆ ให้ link ไปที่ spec

**Frontmatter + TL;DR:** หัวไฟล์มี `kind`/`status`/`blocked_by`/`blocks`/`superseded_by`/`spec`/`priority`
(ค่าเป็น EN เสมอ — เป็น enum ที่ tool อ่าน) แล้วตามด้วย `## TL;DR` ≤15 บรรทัดที่เป็น**ส่วนเดียว
ที่เปลี่ยนได้ระหว่างทำงาน** · `fapony mem kickoff` นับ checkbox ของ section `##` แรกเท่านั้น —
**ห้ามสร้างไฟล์ MASTER.md** ทุกบรรทัดของมัน derive ได้อยู่แล้ว ไฟล์ที่ maintain เองจะตกรุ่นเสมอ ·
`status`/`blocked_by`/`blocks`/`superseded_by` ยังเขียนไว้ได้แต่ตอนนี้ไม่มี tool อ่าน

**Layout `.fapony/{plan,done,spec}`:** `done/` อยู่**ข้าง ๆ** `plan/` ไม่ใช่ข้างใน — ลิงก์
relative รอดทั้งหมด archive เหลือ `git mv` + sed ลิงก์ plan→plan · **ไม่เติมวันที่หน้าชื่อไฟล์**
(วันที่อยู่ใน header `> ✅ **shipped YYYY-MM-DD**` แล้ว — "วันนั้นจบอะไร" ให้ derive ด้วย
`grep -h shipped .fapony/done/*.md | sort`) · **spec ไม่ archive เลย** เพราะ spec คือห้องสมุด
และ spec ที่ไม่ย้าย = ลิงก์ที่ไม่พัง

**งาน wire/refactor ไม่ต้องมี PLAN.md** — คู่ที่ใช้จริงคือ `analyze <dir>` + `review-seed --files`
ตอนเปิด แล้วปิดด้วย `review-pony` — deterministic ทั้งสองหัว ไม่มี LLM คั่นกลาง

---

## CLI Commands

```bash
# ── core: mem + debt ──
fapony mem <add|close|find|kickoff|done|stale|claim|release|synced|plan-sweep|plan-check|rotate>
fapony debt [--id <convention>] [--where <path>]   # ไฟล์ไหนยังไม่ย้ายไป convention ที่ประกาศไว้ (live, read-only)
fapony lint-baseline [--cmd ...] [--diff]   # แยก "แดงอยู่ก่อนแล้ว" ออกจาก "ฉันทำให้แดง"
fapony init-mem                     # ลบ .memory/ เก่า + เตือน call site ที่ยังอ้างถึง (data files ไม่ถูกแตะ)
fapony digest [--since 7d|YYYY-MM-DD] [--format text|html] [--json] [--out FILE]
# ── day-1: usage ──
fapony usage-scan                    # scan session logs → usage-cache.jsonl (incremental)
fapony usage-web [port]              # dashboard เทียบ usage จาก cache (ไม่แตะ session log)
fapony price-scan                    # refresh ตารางราคา model
# ── lookup (read-only, ไม่แตะ state) ──
fapony analyze [path]                # hub/orphan/cycle/changed-untested — live graph, ไม่ persist
fapony review-seed [--staged|--commit <sha>|--range <a...b>|--files f1,f2,dir|--plan <PLAN.md>] [--body sym[,sym]] [--callers sym]
fapony plan-seed <name> [--spec] [--scope <path>]...
# ── ledger (แช่แข็ง — แก้เฉพาะบั๊ก) ──
fapony mcp                           # MCP server — stdio JSON-RPC, 3 tools
fapony hook-stop                     # Stop hook — block เทิร์นที่มี commit แต่ไม่มี mem row ใหม่
fapony hook-read-hint                # annotate 2 แบบ: อ่านไฟล์ใหญ่ทั้งไฟล์ → review-seed ·
                                     # re-read ไฟล์เดิมใน session เดียวกันที่ mtime ไม่ขยับ → grep
fapony hook-edit-hint                # PreToolUse Edit — บอกจำนวน importer ของไฟล์ที่กำลังแก้ (Claude)
fapony hook-session-start            # SessionStart — ยิง `mem kickoff` เข้า context (เงียบถ้าไม่มี mem log)
fapony stats [--mode verdict [--regime code|fix|review|plan|inquiry|test]]
fapony report <run-id>  ·  fapony report-web [file]
# ── setup ──
fapony init <path>  ·  fapony install [--all|--platform <name>|--dry-run]  ·  fapony setup
fapony update  ·  fapony telemetry show|send  ·  fapony test
```

**`review-seed --files` คือ lookup ตอน *execute* ไม่ใช่แค่ "Before" ของ review-pony** — โชว์
export ทุกตัวพร้อมเลขบรรทัด + importer ทุกตัว (uncapped) · **ก่อนแก้ไฟล์ที่ยังไม่รู้จัก ยิงอันนี้
แทนการ Read ทั้งไฟล์** แล้วค่อย Read เฉพาะช่วงบรรทัดที่มันชี้ · **รับ directory ได้ด้วย**
(zone lookup — dir ขยายเป็นไฟล์ source ใต้นั้น cap 40 แล้วบอกตรง ๆ เมื่อตัด) · path ที่ไม่มีจริง
ถูก drop พร้อมแจ้ง not found แทนที่จะนับเป็น changed เงียบ ๆ · scope แบบ diff
(`--commit`/`--range`/`--staged`) ยัง cap เท่าเดิม นั่นคืองบของ review ไม่ใช่ของ lookup

```bash
fapony review-seed --files src/x.ts --body resolveScope,findScope --callers resolveScope
```

`--body` = declaration slice ของ export ที่ระบุ · `--callers` = symbol→symbol scan ข้าม importer
ที่ static graph เห็น (dynamic use อยู่นอกมือ) · **export เท่านั้น** — ฟังก์ชันที่ไม่ export
ตอบว่า "no export named X in scope" ไม่ใช่ "ไม่มี"

**Dead code ใช้ `bunx knip@6`** ([knip.json](knip.json) ignore `templates/**` เพราะ `init-mem`
ก๊อปโฟลเดอร์นั้นไปรีโปอื่น มันจึงไม่มีวันมี importer ที่นี่) · ไม่ผูก CI — gate ที่ต้องปลดล็อก
ทุกครั้งแค่สอนให้ข้าม · **อ่านผลให้ถูก: มันรายงาน _unused export_ ไม่ใช่ unused function**
ให้ถอดคำว่า `export` ไม่ใช่ลบฟังก์ชัน

---

## MCP Tools: fapony

`fapony mcp` — stdio JSON-RPC, **3 tools** (`mem_add` เข้ามาพร้อม PLAN-agent-one-call ·
`plan_list` ออกไป 2026-09-20 · `fapony_usage` ออกไป 2026-09-20 เหลือ CLI · `mem_close`
เข้ามา 2026-09-21 เป็น tool แยกเพราะ close row ไม่มี `files[]` — ดูกฎ 12/13):

| Tool | Purpose |
|------|---------|
| `mem_find` | **แกน** — ค้น mem log read-only: match `files[]` ที่เก็บจริงในแถวก่อน แล้ว fallback เป็น substring ของ text/spec/ref สำหรับแถวเก่าที่เขียนตอนยังไม่มี `--files` · ทุก kind ไม่มี default filter · `memDir:null` = ไม่มี mem (ไม่ใช่ "ไม่เจอ") |
| `mem_add` | **แกน — ครึ่งเขียนของ `mem_find`** · append mem row (`decision`/`bug`/`note`/`next`/`hold`) โดย `files[]` **required + reject เมื่อว่าง** (กฎ 9: required ได้ผล การขอไม่ได้ผล) — แถวที่ไม่บอกไฟล์ หาไม่เจอตอนแตะไฟล์นั้น |
| `mem_close` | **แกน — ครึ่งปิดของ `mem_add`** · ปิด row ด้วย id + tombstone message (`ref`+`text`, ไม่มี `files[]`) ฉะนั้นเป็น tool แยก ไม่ใช่ `kind:"close"` — schema ที่ required field ขึ้นกับค่าของอีก field คือรูปทรงที่เรียกผิดบ่อยที่สุด |

**ที่ถอดออกไปแล้วและห้ามเอากลับ:** `verdict_submit` (2026-09-21 — PLAN-verdict-to-mem: schema
2,126/5,049 ตัวอักษร = 42% ของค่าเช่าทุก session · เกรด 93.9% pass-family ไม่เคย discriminate ·
Stop hook เปลี่ยนไปบังคับ mem row แทน · engine อยู่ใน git ฟื้นเป็น CLI ได้) · `fapony_usage` (2026-09-20 — สอบตกกฎ 13: คนเรียกมีแต่เจ้าของ
("เมื่อวานเผาไปเท่าไหร่") ไม่ใช่ agent กลางเทิร์น · ทุก client แสดง token ของตัวเองอยู่แล้ว เหลือข้ออ้าง
เดียวคือ cross-client ruler ซึ่ง CLI `usage-scan`/`usage-web` ตอบได้เหมือนกันด้วยค่าเช่าศูนย์ ·
ลบ `src/mcp/tools/usage.ts` + test ทิ้ง, engine `src/session/` + `src/usage/` อยู่ครบเพราะ CLI ใช้ ·
statusline integration ถอดออกทั้งฟีเจอร์ 2026-09-21 — caller ศูนย์บนเครื่องเจ้าของ (ponytail
plugin's statusline ชนะไปแล้ว) และ cache write (`writeStatuslineCache` ใน transport.ts) ไม่มีใคร
อ่านต่อ ตามกฎ 12) ·
`plan_list` (2026-09-20 — `fapony mem kickoff` ตอบ
"เหลืออะไร" จาก plan file ชุดเดียวกัน · ลบ `src/mcp/tools/plans.ts` + `getLastVerdictByPlan`
ทิ้งด้วยเพราะไม่มี caller เหลือ ตามกฎ 12) · **สิ่งที่หายไปจริงวัดแล้วว่าเล็ก** (กฎ 2): ใน plan
ทั้งหมด 42 ไฟล์ (plan/ 3 + done/ 39) `blocked_by` ถูกใช้ **0 ไฟล์ all-time** · `blocks` 3 ·
`superseded_by` 2 · `status` 18 — คำถาม "อะไร blocked" ที่ plan_list ถูกสร้างมาตอบ ไม่เคยมี
ข้อมูลให้ตอบ และ plan ที่ยังไม่ ship มี 3 ไฟล์ซึ่ง `ls` ก็พอ · ถ้าวันหนึ่งอยากได้ view นั้นจริง
**ให้ฟื้นเป็น CLI `fapony plan-list`** (engine อยู่ใน git ที่ 46e0dac) ไม่ใช่เอากลับเข้า MCP · `fapony_stats` (CLI `fapony stats` ตอบเหมือนกันทุกอย่าง และ
description ของมันขายว่า "บอกได้ว่าควรจ่ายให้ model ไหน" ซึ่งขัด Positioning ข้อ 2) ·
`project_health_context` (caller ศูนย์ — engine `src/context/projectHealth.ts` ยังอยู่ ใช้จาก CLI ได้) ·
`verification_report` / `handoff_check` / `handoff_collect` (ถอดไปก่อนหน้านี้ด้วยเหตุผลเดียวกัน) ·
`verdict_submit` (2026-09-21 — PLAN-verdict-to-mem: schema 2,126/5,049 ตัวอักษร = 42% ของค่าเช่า
ทุก session · เกรด 93.9% pass-family ไม่เคย discriminate · Stop hook เปลี่ยนไปบังคับ mem row
แทน · engine อยู่ใน git ฟื้นเป็น CLI ได้) ·
**วัดแล้ว: schema ทั้งชุด 5,049 → 3,654 ตัวอักษร (−27.6% จากการถอด `verdict_submit`
เหลือ 3 tools — วัดด้วย tools/list JSON + instructions)**

ดู [docs/mcp-handcheck.md](docs/mcp-handcheck.md) สำหรับ protocol, adapter examples, safety rules

---

## code-review-graph — CLI เท่านั้น (MCP ถอดแล้ว 2026-09-19)

เจ้าของถอด MCP server ของ code-review-graph ออกเพราะ **แทบไม่ถูกเรียก** — ค่าเช่า schema
จ่ายทุก session แต่ค่าที่ได้คืนเกือบศูนย์ (กฎ 13 รูปเดียวกับที่ `fapony_stats` โดน) ·
**CLI `code-review-graph` ยังอยู่บน PATH และ graph ยังอัปเดตทุก commit ผ่าน pre-commit hook**

ใช้เมื่อ narrow scope ก่อนอ่าน source — ถูกกว่าการ scan ไฟล์ และให้ callers/dependents/tests
ที่ file search ให้ไม่ได้ · **แต่ยืนยันใน source เสมอ**: graph อ่าน commit ล่าสุด ไม่ใช่ไฟล์ที่
กำลังแก้ · เมื่อ graph กับ source ขัดกัน **source ชนะ** · ผลว่างแปลได้ทั้ง "ไม่ได้ index" และ
"ไม่เห็นแบบ static" ไม่ใช่ "ไม่มี" · **ไม่มี graph ไม่ใช่เหตุผลให้หยุด — `fapony review-seed
--files` ตอบคำถามเดียวกันได้ส่วนใหญ่และเป็นของในบ้าน**
