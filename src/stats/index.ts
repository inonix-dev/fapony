// src/stats/index.ts — barrel re-export

export { cmdStats, currentWorktree } from "./cli.js";
export {
  countPendingPlans,
  getPlanBreakdown,
  getStatsData,
  type PlanBreakdown,
  resolveMaxRounds,
  type StatsData,
} from "./data.js";
export {
  computeFrontier,
  type FrontierRow,
  formatStatsText,
  formatVerdictText,
  type VerdictRow,
} from "./format.js";
