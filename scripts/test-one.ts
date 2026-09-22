// scripts/test-one.ts — run one test file's exported tests, or one by name.
// The full suite is 40s; this is ~3s, which is the difference between running
// the check that covers your edit and not running it. `bun run check` stays
// the gate — SKIP_SLOW is deliberately not the default, because the one test
// it skips (testClaimMemoryTimeout) is the one that prevents a hang.
export {};

const [file, picked] = process.argv.slice(2);
if (!file) {
  console.error("usage: bun run test:one <file> [testName]");
  console.error("  e.g. bun run test:one stats");
  console.error("       bun run test:one stats testStatsByRegimeSplit");
  process.exit(1);
}

const mod: Record<string, unknown> = await import(`../test/${file}.test.ts`);
const isTest = (k: string): boolean => typeof mod[k] === "function";
if (picked && !isTest(picked)) {
  console.error(`no test named ${picked} in test/${file}.test.ts`);
  console.error(`available: ${Object.keys(mod).filter(isTest).join(", ")}`);
  process.exit(1);
}

const all = picked ? [picked] : Object.keys(mod).filter(isTest);
// Same contract as test/index.ts: SKIP_SLOW=1 drops the 15s hang-guard sleep.
// Without this, `test:one memory` pays the sleep every dev iteration.
const names =
  !picked && process.env.SKIP_SLOW
    ? all.filter((n) => n !== "testClaimMemoryTimeout")
    : all;
for (const n of names) await (mod[n] as () => unknown)();
console.log(`\n${names.length} test(s) passed ✓`);
