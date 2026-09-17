// src/stats/index.ts — barrel re-export

export { cmdStats } from "./cli.js";
export {
  countPendingPlans,
  getLastVerdictByPlan,
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
