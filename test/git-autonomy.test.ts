import { test } from "bun:test";
// test/git-autonomy.test.ts — git-autonomy rewrites (opt-in opencode plugin)

import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GIT_AUTONOMY_COMMIT_POLICY,
  gitAutonomyStatus,
  rewriteGitAutonomySystem,
  rewriteGitAutonomyTool,
} from "../src/adapters/hooks/git-autonomy.js";
import {
  cmdInstall,
  cmdInstallOpencode,
  gitAutonomyPluginSource,
  INSTALL_ROOT,
} from "../src/install.js";
import {
  captureErrors,
  silentErrors,
  testExit,
  withTempHome,
} from "./install/helpers.js";

const ASK_FIRST =
  "NEVER commit changes unless the user explicitly asks you to. Otherwise be too proactive.";
const BASH_LINE =
  "- Only commit, amend, push, or create PRs when explicitly requested.";

test("testGitAutonomyRewritesAskFirst", () => {
  const { text, matched } = rewriteGitAutonomySystem(`policy: ${ASK_FIRST}`);
  assert.ok(!text.includes("NEVER commit changes"), `got: ${text}`);
  assert.ok(text.includes(GIT_AUTONOMY_COMMIT_POLICY), `got: ${text}`);
  assert.ok(matched.includes("system-commit-full"), `got: ${matched}`);
  console.log("  ✓ git-autonomy rewrites the ask-first system rule");
});

test("testGitAutonomyFallbackCatchesReword", () => {
  const { text, matched } = rewriteGitAutonomySystem(
    "NEVER commit changes to main without approval.",
  );
  assert.ok(text.includes(GIT_AUTONOMY_COMMIT_POLICY), `got: ${text}`);
  assert.ok(matched.includes("system-commit-fallback"), `got: ${matched}`);
  console.log("  ✓ git-autonomy fallback catches a reworded ban");
});

test("testGitAutonomyRewritesBashDescBothSurfaces", () => {
  const sys = rewriteGitAutonomySystem(`# Git and GitHub:\n${BASH_LINE}`);
  assert.ok(
    !sys.text.includes("when explicitly requested"),
    `got: ${sys.text}`,
  );
  assert.ok(sys.matched.includes("system-bash-desc"), `got: ${sys.matched}`);
  const tool = rewriteGitAutonomyTool(
    "bash",
    `# Git and GitHub:\n${BASH_LINE}`,
  );
  assert.ok(
    tool.description.includes("Commit finished work as you go"),
    `got: ${tool.description}`,
  );
  assert.deepStrictEqual(tool.matched, ["tool-bash-commit"]);
  // Other tools are untouched — the rewrite is keyed by toolID.
  const other = rewriteGitAutonomyTool("read", BASH_LINE);
  assert.equal(other.description, BASH_LINE);
  assert.deepStrictEqual(other.matched, []);
  console.log("  ✓ git-autonomy rewrites both surfaces, bash only");
});

test("testGitAutonomyCutsToneExamples", () => {
  const src = [
    "# Tone and style",
    "Here are some examples to demonstrate appropriate verbosity:",
    "<example>2+2</example>",
    "# Git and GitHub",
  ].join("\n");
  const { text, matched } = rewriteGitAutonomySystem(src);
  assert.ok(!text.includes("<example>"), `got: ${text}`);
  assert.ok(text.includes("# Git and GitHub"), "next heading must survive");
  assert.ok(matched.includes("system-tone-examples"), `got: ${matched}`);
  console.log("  ✓ git-autonomy cuts the tone few-shot block");
});

test("testGitAutonomyStatusNamesStale", () => {
  const ok = gitAutonomyStatus(
    [`policy: ${ASK_FIRST}`, `# Git:\n${BASH_LINE}`],
    { bash: BASH_LINE },
  );
  assert.equal(ok.ok, true);
  assert.deepStrictEqual(ok.stale, []);
  // Upstream rewords everything: every required id goes stale at once, and
  // the names say which surface drifted — the analyze-like help.
  const stale = gitAutonomyStatus(["hello, brand new prompt"], {
    bash: "hello, brand new tool",
  });
  assert.equal(stale.ok, false);
  assert.ok(stale.stale.includes("system-commit"), `got: ${stale.stale}`);
  assert.ok(stale.stale.includes("system-bash-desc"), `got: ${stale.stale}`);
  assert.ok(stale.stale.includes("tool-bash-commit"), `got: ${stale.stale}`);
  console.log("  ✓ git-autonomy status names stale patterns");
});

test("testGitAutonomyPluginSourceDefersToShared", () => {
  const src = gitAutonomyPluginSource("/install/root");
  assert.ok(src.includes("/install/root/src/hook.ts"), "bakes install root");
  assert.ok(src.includes("rewriteGitAutonomySystem"), "no baked system regex");
  assert.ok(src.includes("rewriteGitAutonomyTool"), "no baked tool regex");
  assert.ok(
    src.includes("experimental.chat.system.transform"),
    "hooks the system surface",
  );
  assert.ok(src.includes('"tool.definition"'), "hooks the tool surface");
  assert.ok(!src.includes("NEVER commit"), "must not bake upstream text");
  assert.ok(
    !src.includes("throw"),
    "must never break a session or hide a tool",
  );
  console.log("  ✓ git-autonomy plugin defers to shared logic, both hooks");
});

function autonomyPath(home: string): string {
  return join(home, ".config", "opencode", "plugins", "fapony-git-autonomy.ts");
}

test("testGitAutonomyDefaultInstallWritesNothing", () => {
  withTempHome((home) => {
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    assert.ok(
      !existsSync(autonomyPath(home)),
      "default install must not write the opt-in plugin",
    );
    console.log("  ✓ git-autonomy default install writes nothing");
  });
});

test("testGitAutonomyOptInWritesPlugin", () => {
  withTempHome((home) => {
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(
          false,
          { exit: testExit, homedir: () => home },
          { gitAutonomy: true },
        ),
      ),
    );
    const src = readFileSync(autonomyPath(home), "utf-8");
    assert.ok(src.includes("FaponyGitAutonomy"), "must carry our marker");
    assert.ok(err.includes("git-autonomy"), `got: ${err}`);
    // Idempotent: second install keeps the file byte-identical.
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(
          false,
          { exit: testExit, homedir: () => home },
          { gitAutonomy: true },
        ),
      ),
    );
    assert.equal(readFileSync(autonomyPath(home), "utf-8"), src);
    console.log("  ✓ git-autonomy opt-in writes the plugin once");
  });
});

test("testGitAutonomyForeignFileUntouched", () => {
  withTempHome((home) => {
    const p = autonomyPath(home);
    mkdirSync(join(home, ".config", "opencode", "plugins"), {
      recursive: true,
    });
    writeFileSync(p, "// someone else's plugin\n");
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(
          false,
          { exit: testExit, homedir: () => home },
          { gitAutonomy: true },
        ),
      ),
    );
    assert.equal(readFileSync(p, "utf-8"), "// someone else's plugin\n");
    console.log("  ✓ git-autonomy leaves foreign files alone");
  });
});

test("testGitAutonomyStaleRefreshed", () => {
  withTempHome((home) => {
    const p = autonomyPath(home);
    mkdirSync(join(home, ".config", "opencode", "plugins"), {
      recursive: true,
    });
    const stale =
      "// fapony git-autonomy\nexport const FaponyGitAutonomy = async () => ({});\n";
    writeFileSync(p, stale);
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(
          false,
          { exit: testExit, homedir: () => home },
          { gitAutonomy: true },
        ),
      ),
    );
    assert.match(err, /git-autonomy: updated/, `got: ${err}`);
    assert.equal(
      readFileSync(p, "utf-8"),
      gitAutonomyPluginSource(INSTALL_ROOT),
      "our own stale plugin must be rewritten to the current template",
    );
    console.log("  ✓ git-autonomy stale plugin refreshed in place");
  });
});

test("testGitAutonomyDryRunNoWrite", () => {
  withTempHome((home) => {
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(
          true,
          { exit: testExit, homedir: () => home },
          { gitAutonomy: true },
        ),
      ),
    );
    assert.ok(!existsSync(autonomyPath(home)), "dry-run must not write");
    console.log("  ✓ git-autonomy dry-run writes nothing");
  });
});

test("testGitAutonomyDispatchFlag", async () => {
  withTempHome((home) => {
    silentErrors(() =>
      captureErrors(() =>
        cmdInstall(["opencode", "--git-autonomy"], {
          exit: testExit,
          homedir: () => home,
        }),
      ),
    );
    assert.ok(
      existsSync(autonomyPath(home)),
      "install opencode --git-autonomy must write the plugin",
    );
    console.log("  ✓ install opencode --git-autonomy dispatches the flag");
  });
});
