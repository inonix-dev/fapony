import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, loadConfig } from "../src/core/config.js";
import { addEvent, newRun, openDb, setStatus } from "../src/db/store.js";
import { cmdReportWeb, wouldBeCommitted } from "../src/report/cli.js";
import { renderReportHtml } from "../src/report/index.js";
import { getStatsData } from "../src/stats/index.js";
import { withTempRepo } from "./helpers.js";

function _baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

function withTestDb(fn: (db: ReturnType<typeof openDb>) => void): void {
  const prev = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = `/tmp/fapony-report-html-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    const db = openDb();
    fn(db);
    db.close();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
  }
}

function seedTwoRounds(db: ReturnType<typeof openDb>): void {
  const run = newRun(db, "/Users/test/project", null, null, "abc");
  addEvent(db, run, "spawn", { role: "executor", model: "m" });
  addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 1 });
  addEvent(db, run, "spawn", { role: "executor", model: "m" });
  addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 2 });
  setStatus(db, run, "passed");
}

export function testReportHtmlCanonicalQuality(): void {
  // pass-good = 4 via the shared helper — never a local score map.
  withTestDb((db) => {
    seedTwoRounds(db);
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
    assert.ok(html.includes("4.0"), "canonical quality rendered");
  });

  console.log("  ✓ report-html uses canonical quality scores");
}

export function testReportHtmlFiltersAndMethodology(): void {
  withTestDb((_db) => {
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
    assert.ok(html.includes('id="f-model"'), "model filter present");
    assert.ok(html.includes('id="f-grade"'), "grade filter present");
    assert.ok(html.includes('id="f-worktree"'), "worktree filter present");
    assert.ok(html.includes("<script>"), "filter JS present");
    assert.ok(html.includes("Methodology"), "methodology present");
    assert.ok(
      html.includes("Insufficient data"),
      "insufficient-data banner on empty db",
    );
    assert.ok(html.includes("basename"), "basename note present");
  });

  console.log("  ✓ report-html has filters, methodology, insufficient-data");
}

export function testReportHtmlByModelHasAttributionColumns(): void {
  // Spawn-based windows carry no client/provider/agent → "—", never blank.
  withTestDb((db) => {
    seedTwoRounds(db);
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
    for (const h of [
      "<th>Client</th>",
      "<th>Provider</th>",
      "<th>Agent</th>",
    ]) {
      assert.ok(html.includes(h), `By Model table has ${h}`);
    }
    assert.ok(html.includes("<td>—</td>"), "unknown dims render as —");
  });

  console.log("  ✓ report-html By Model shows client/provider/agent");
}

export function testReportHtmlByModelProjectColumn(): void {
  // byModel groups by worktree, so a global report lists the same model once
  // per project — rows need a Project column, scoped reports must not repeat it.
  withTestDb((db) => {
    for (const wt of ["/proj/a", "/proj/b"]) {
      const run = newRun(db, wt, null, null, "abc");
      addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 0 });
      setStatus(db, run, "passed");
    }
    const all = renderReportHtml(getStatsData(), new Date().toISOString());
    assert.ok(
      all.includes("<th>Project</th>"),
      "global report has Project column",
    );
    assert.ok(all.includes("<td>/proj/a</td>"), "project row labeled");
    const scoped = renderReportHtml(
      getStatsData("/proj/a"),
      new Date().toISOString(),
    );
    assert.ok(
      !scoped.includes("<th>Project</th>"),
      "scoped report hides Project column",
    );
    assert.ok(scoped.includes("Scope: /proj/a"), "scoped report labels scope");
  });

  console.log("  ✓ report-html By Model Project column follows scope");
}

export function testReportHtmlEscapesContent(): void {
  // Worktree basenames are interpolated into HTML — must not break markup.
  withTestDb((db) => {
    newRun(db, "/x/<b>pwn", null, null, "abc");
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
    assert.ok(!html.includes("<b>pwn"), "raw worktree markup must not appear");
    assert.ok(html.includes("&lt;b&gt;pwn"), "worktree markup escaped");
  });

  console.log("  ✓ report-html escapes interpolated strings");
}

export function testReportWebWarnsOnlyWhenCommittable(): void {
  withTempRepo((repo) => {
    writeFileSync(join(repo, ".gitignore"), "out/\n");
    // The probe runs git from dirname(path), so that dir has to exist — same
    // as the real call, where writeFileSync would need it anyway.
    mkdirSync(join(repo, "out"));

    assert.ok(
      wouldBeCommitted(join(repo, "report.html")),
      "untracked, unignored path in a repo would be committed",
    );
    assert.ok(
      !wouldBeCommitted(join(repo, "out", "report.html")),
      "gitignored path is safe — no warning",
    );
  });

  const outside = mkdtempSync(join(tmpdir(), "fapony-norepo-"));
  try {
    assert.ok(
      !wouldBeCommitted(join(outside, "report.html")),
      "path outside any repo is safe — no warning",
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }

  console.log("  ✓ report-web warns only when the output would be committed");
}

export function testReportWebRefusesWhenCommittable(): void {
  withTempRepo((repo) => {
    mkdirSync(join(repo, "out"));
    const target = join(repo, "report.html");
    let code: number | null = null;
    const origExit = process.exit;
    try {
      process.exit = ((c?: number) => {
        code = c ?? 0;
        throw new Error("__exit__");
      }) as never;
      cmdReportWeb([target]);
    } catch {
      // exit stub unwinds
    } finally {
      process.exit = origExit;
    }
    assert.equal(code, 1, "exits 1 when output would be committed");
    assert.ok(!existsSync(target), "file not written");
  });

  console.log(
    "  ✓ report-web refuses to write when wouldBeCommitted and no --force",
  );
}

export function testReportWebForceOverrides(): void {
  withTempRepo((repo) => {
    mkdirSync(join(repo, "out"));
    const target = join(repo, "report.html");
    cmdReportWeb([target, "--force"]);
    assert.ok(
      readFileSync(target, "utf-8").length > 0,
      "file written with --force",
    );
  });

  console.log("  ✓ report-web --force writes even when wouldBeCommitted");
}
