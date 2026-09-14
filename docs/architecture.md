# fapony — Architecture (file-by-file)

> **Used by:** [CLAUDE.md](../CLAUDE.md) — ย้ายออกมาเพราะเป็น *lookup* ไม่ใช่ *rule*
> อ่านตอนหาที่วางโค้ดใหม่ ไม่ใช่ทุก session


```
fapony/
  fapony.ts           # CLI dispatch — init|init-mem|install|mcp|report|report-web|usage-scan|usage-web|analyze|setup|stats|telemetry|test|update
  fapony.config.json  # runtime config (worktrees, review.maxRounds, memory, paths, safety) — optional, gitignored
  skill/                        # <name>/SKILL.md — symlinked into clients by `fapony install`
                                # each SKILL.md is self-contained — the symlink ships only
                                # skill/<name>/, so a link out of that dir is dead on install
    plan-with-pony/             # draft plan + spec จาก conversation (pipe to any agent's stdin)
    review-pony/                # review as verification + known patterns before, verdict after
    move-to-done/               # archive PLAN เข้า .fapony/done/ หลัง ship
    git-commit-conventional/    # commit แยก concern + conventional message
    git-ship/                   # push branch, open PR, merge, reset branch onto base
  templates/
    PLAN.md / SPEC.md / mem/     # plan+spec templates, memory scaffold for `fapony init`
                                 # (ชื่อโฟลเดอร์ = ชื่อ CLI ที่มันเป็น (`mem`) ไม่ใช่ปลายทางที่ไปวาง (.memory/))
  src/
    db/               # SQLite + config
      store.ts        # openDb + schema/migration (PRAGMA user_version) + CRUD
      load.ts         # loadConfig()
      getters.ts      # getters รวมศูนย์ — ห้าม hardcode ที่ call site
      types.ts        # Config / Row types
      defaults.ts     # DEFAULT_* constants (safety deny list, …)
      index.ts        # re-export
    gates.ts          # per-round gate enrichment — model + session tokens per gate; carries `sessionId` so callers can dedupe
    parse.ts          # parseGateVerdict() + qualityScore()
    memory.ts         # shell adapter + resolveMemoryConfig + DEFAULT_MEMORY
    safety.ts         # assertSafe() deny-list (checked before any config-sourced shell cmd runs)
    session/           # passive usage readers — OpenCode (SQLite), ZCode (SQLite), Claude Code (JSONL), Codex (JSONL)
      activeSession.ts # loadSessionSpans/findSessionAt — which client session was live in a worktree at time T (model attribution without asking the caller)
      index.ts         # re-exports (backward compat)
      types.ts         # ModelBreakdown, SessionDetail, UsageDetail, StepTimingSummary, PassiveUsageResult
      helpers.ts       # buildWhereClause(), aggregateDetail(), readDetailFromDb(), parseTimeMs()/extractPartTiming()/summarizeTiming()/collectTiming()/readTimingFromDb()
      opencode.ts      # readPassiveUsage() — OpenCode session DB
      zcode.ts         # readZcodeUsage() — ZCode session DB
      claude-code.ts   # readClaudeCodeUsage() — Claude Code JSONL files
      codex.ts         # readCodexUsage() — Codex JSONL files
    context/           # project-health context block, keyed by files[] (any caller)
      projectHealth.ts # buildProjectHealthContext() — pure over StatsData, ~15 lines max
      index.ts         # barrel re-export
    math.ts            # minutesBetween(), avg() — shared pure numeric helpers
    init.ts            # fapony init — scaffold .fapony/{plan,done,spec,.memory,evidence.json}
    init-mem.ts        # init-mem — scaffold/refresh (`--update`) the memory copy; `init` reuses its copyDir
    stats/                # fapony stats — KPI across runs
      data.ts             # getStatsData() + StatsData type + computeEfficiency() + reason_code/plan/escalation/best-passing queries
      format.ts           # formatStatsText() — CLI + MCP text mode
      cli.ts              # cmdStats()
      index.ts            # barrel re-export
    web/                  # shared HTML helpers (report-web + usage-web)
      html.ts             # esc(), DARK_THEME_CSS, TABLE_CSS
      index.ts            # barrel re-export
    report/               # fapony report / report-web — verification report
      cli.ts              # cmdReport (per-run), cmdReportWeb (aggregate HTML)
      render.ts           # renderReportHtml(stats, generated_at) — renders from StatsData
      format.ts           # fmtRate, fmtUsd, fmtMinutes, insufficientData
      index.ts            # barrel re-export
    usage/                # fapony usage-web — live usage comparison dashboard
      cli.ts              # cmdUsageWeb + Bun.serve routes (/, /data, /favicon.ico)
      render.ts           # renderUsageHtml() — HTML with summary cards + per-client tables
      format.ts           # fmtTokens(), fmtCost(), fmtDelta(), shortModel() — re-exports esc() from web/
      index.ts            # barrel re-export
    telemetry.ts        # opt-in payload (runs/events allowlist เท่านั้น)
    setup.ts            # fapony setup — interactive wizard: config + scaffold ในขั้นเดียว
    install.ts          # barrel — re-exports src/install/ (fapony install --platform …)
    install/            # one file per client + shared pieces
      claude.ts         # `claude mcp add` (never writes ~/.claude.json directly)
      opencode.ts       # ~/.config/opencode/opencode.json(c)
      zcode.ts          # ~/.zcode/cli/config.json (fallback ~/.agents/mcp.json)
      codex.ts          # ~/.codex/config.toml
      skills.ts         # linkSkills() — symlinks skill/<name>/ into ~/.claude/skills, never overwrites
      types.ts          # InstallDeps / ClaudeRunResult / defaultExit
      utils.ts          # shared JSON(C) helpers
    update.ts            # fapony update — self-update via git pull (tripwire test คุม ROOT)
    util.ts               # templateArgs / fillPrompt / isAffirmative
    mcp/                   # MCP server — stdio JSON-RPC, 8 tools
      index.ts             # MCP entry point + tool registration
      transport.ts         # JSON-RPC framing (stdin/stdout) + SERVER_INSTRUCTIONS (initialize) — how agents learn the grading habit without editing their own rules file
      evidence.ts          # allowlisted evidence collector (.fapony/evidence.json — never runs agent-proposed cmds)
      types.ts             # MCP type definitions
      tools/
        collect.ts         # handoff_collect — git facts
        check.ts           # handoff_check — conformance
        verdict.ts         # verdict_submit — 6-grade verdict storage
        stats.ts           # fapony_stats — KPI query
        usage.ts           # fapony_usage — passive OpenCode session usage
        report.ts          # verification_report — facts + checks + evidence + verdict, one call
        plans.ts           # plan_list — pending plan files joined with run history
        context.ts         # project_health_context — known patterns by files[]
    test.ts               # self-check ตัวเอง (thin wrapper → test/index.ts)
  test/
    *.test.ts              # one file per src module
    mcp/                   # MCP tool tests
```

