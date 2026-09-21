// gateOnce is the core review-verdict logic — still live, called by the CLI
// wrapper (cmdGate) was removed with the rest of the execute→review→fix loop
// (Wave 2). The MCP verdict_submit tool was removed in PLAN-verdict-to-mem.
import {
  addEvent,
  getRun,
  incrementRound,
  loadConfig,
  openDb,
  setStatus,
} from "./db/index.js";
import { closeMemory, kickoffMemory } from "./memory.js";
import { isPassFamily, type VerdictGrade } from "./parse.js";

export interface GateResult {
  runId: number;
  status: "passed" | "fixing" | "stopped" | "stalled";
  round?: number;
  error?: string;
}

/**
 * Core gate logic — does NOT call process.exit.
 * CLI wrapper (cmdGate) is responsible for exit codes.
 *
 * Verdict routing (3 groups):
 *   pass-family (pass-excellent|pass-good|pass-adequate|pass) → passed
 *   fail → fixing (+ round cap check → stalled)
 *   uncertain → stopped (same shape as round-cap path)
 */
export function gateOnce(
  runId: number,
  verdict: VerdictGrade,
  note: string,
  files?: string[],
): GateResult {
  const db = openDb();
  const run = getRun(db, runId);
  if (!run) {
    return { runId, status: "stopped", error: `run ${runId} not found` };
  }
  if (
    run.status === "passed" ||
    run.status === "stopped" ||
    run.status === "stalled"
  ) {
    return {
      runId,
      status: run.status,
      round: run.round,
      error: `run ${runId} is already ${run.status}`,
    };
  }

  const config = loadConfig();
  // runs.worktree stores an absolute path (SERVER_INSTRUCTIONS mandates it) — not a key in config.worktrees
  // so the lookup always misses, and the old "." fallback ran the project's memory commands in the cwd of
  // the MCP server instead of that project · the lookup stays in case an old row was stored as a key
  const worktree = config.worktrees[run.worktree] ?? run.worktree;

  // --- pass family (4 grades) ---
  if (isPassFamily(verdict)) {
    setStatus(db, runId, "passed");
    // round = run's current round at review time (pre-increment for fail).
    addEvent(db, runId, "gate", {
      verdict,
      note,
      round: run.round,
      ...(files && files.length > 0 ? { files } : {}),
    });

    if (run.mem_id && config.memory) {
      closeMemory(config, worktree, run.mem_id, note || `run ${runId} passed`);
      addEvent(db, runId, "memory_claim_closed", { mem_id: run.mem_id });
    }

    const kickoff = kickoffMemory(config, worktree);
    if (kickoff) console.log(kickoff);

    return { runId, status: "passed", round: run.round };
  }

  // --- uncertain → stop (plan problem, same as round-cap) ---
  if (verdict === "uncertain") {
    setStatus(db, runId, "stopped");
    addEvent(db, runId, "gate", {
      verdict,
      note,
      round: run.round,
      ...(files && files.length > 0 ? { files } : {}),
    });
    addEvent(db, runId, "stop", { reason: "verdict_uncertain" });

    if (run.mem_id) {
      closeMemory(
        config,
        worktree,
        run.mem_id,
        `run ${runId} stopped — uncertain verdict`,
      );
      addEvent(db, runId, "memory_claim_closed", { mem_id: run.mem_id });
    }
    return { runId, status: "stopped", round: run.round };
  }

  // --- fail → back to executor, one more round ---
  incrementRound(db, runId);
  setStatus(db, runId, "fixing");
  addEvent(db, runId, "gate", {
    verdict,
    note,
    round: run.round,
    ...(files && files.length > 0 ? { files } : {}),
  });

  const updated = getRun(db, runId);
  if (!updated) {
    setStatus(db, runId, "stopped");
    return {
      runId,
      status: "stopped",
      error: `run ${runId} disappeared after update`,
    };
  }

  if (updated.round > config.review.maxRounds) {
    // Round cap reached — the plan is the problem, stall for real. Persist it
    // (else the run sits in 'fixing' forever) and release the memory claim.
    // stalled (not stopped): tells the caller to take it back to the human
    // instead of sending the agent for another fix round.
    setStatus(db, runId, "stalled");
    addEvent(db, runId, "stop", {
      reason: `round ${updated.round} > maxRounds ${config.review.maxRounds}`,
    });
    if (run.mem_id) {
      closeMemory(
        config,
        worktree,
        run.mem_id,
        `run ${runId} stalled at round cap`,
      );
      addEvent(db, runId, "memory_claim_closed", { mem_id: run.mem_id });
    }
    return {
      runId,
      status: "stalled",
      round: updated.round,
      error: `round ${updated.round} > maxRounds ${config.review.maxRounds} — stop fixing and take it back to the human, the plan likely has a problem`,
    };
  }

  return { runId, status: "fixing", round: updated.round };
}
