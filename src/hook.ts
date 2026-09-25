// src/hook.ts — re-export shim (PLAN-lib-layer chunk 3)
//
// All hook logic now lives in src/adapters/hooks/. This file re-exports
// everything for backwards compatibility: test/hook.test.ts,
// src/digest/collect.ts, and the generated OpenCode plugin all import
// from this path.

export * from "./adapters/hooks/index.js";
