// test/index.ts — test runner. Import all test modules and run sequentially.

import {
  testClaudeProjectSlug,
  testFindSessionAt,
} from "./activeSession.test.js";
import {
  testAnalyzeBlastRadius,
  testAnalyzeBlastRadiusTransitive,
  testAnalyzeBlastRadiusTransitiveCycle,
  testAnalyzeChangedUntested,
  testAnalyzeEmptyDir,
  testAnalyzeHubOrphanCycle,
  testAnalyzeIsTestFile,
  testAnalyzeSkipsUnresolvableAndBroken,
} from "./analyze.test.js";
import {
  testConfigDefaults,
  testConfigFileOverrides,
  testConfigUnknownKeysRideAlong,
  testCustomSafetyDeny,
  testTemplateArgsReplaceAll,
} from "./config.test.js";
import {
  testComputeModelFit,
  testContextBlockFilesFilterBeyondTop3,
  testContextBlockHubCapHolds,
  testContextBlockHubLine,
  testContextBlockHubLowHistory,
  testContextBlockHubSilentBelowThreshold,
  testContextBlockLineCap,
  testContextBlockLowHistory,
  testContextBlockLowHistoryStillShowsNotes,
  testContextBlockMemDecisions,
  testContextBlockMergesReasonsAcrossWorktrees,
  testContextBlockModelFitLine,
  testContextBlockNoPatterns,
  testContextBlockNoteCapAndNoneTag,
  testContextBlockRecentNotes,
  testContextBlockSnapshot,
  testContextBlockWorktreeScope,
  testContextToolEmptyDb,
  testContextToolEndToEnd,
  testContextToolHubEndToEnd,
} from "./context.test.js";
import {
  testDbLifecycle,
  testLegacyDbStampedWithoutDataLoss,
  testMigrateDbRejectsNewerSchema,
  testSchemaVersionStamped,
} from "./db.test.js";
import {
  testDigestBugOpenClose,
  testDigestEmptyRepo,
  testDigestEscInjection,
  testDigestInvalidSince,
  testDigestJsonSubsetOfText,
  testDigestMalformedLine,
  testDigestPlanProgress,
  testDigestSinceFilter,
} from "./digest.test.js";
import {
  testFindSessionModelClaudeCodeHit,
  testFindSessionModelClaudeCodeMajority,
  testFindSessionModelClaudeCodeMiss,
  testFindSessionModelClaudeCodeTieGoesLast,
  testFindSessionModelCodexHit,
  testFindSessionModelCodexMiss,
  testFindSessionModelCodexMultiMeta,
  testFindSessionModelCodexMultiMetaTieGoesLast,
  testFindSessionModelEmptyId,
  testFindSessionModelNoReadersAvailable,
  testFindSessionModelOpenCodeHit,
  testFindSessionModelOpenCodeMiss,
  testFindSessionModelOpenCodePlainTextProviderUnknown,
  testFindSessionModelZcodeHit,
  testFindSessionModelZcodeMiss,
  testFindSessionModelZcodeMultiModel,
  testFindSessionModelZcodeRawProviderPassthrough,
  testFindSessionModelZcodeSummedTokensWin,
} from "./findModel.test.js";
import {
  testGateOnceAlreadyPassed,
  testGateOnceAlreadyStalled,
  testGateOnceFail,
  testGateOnceMaxRounds,
  testGateOncePass,
  testGateOncePassAdequate,
  testGateOncePassExcellent,
  testGateOncePassGood,
  testGateOnceUncertain,
} from "./gate.test.js";
import {
  testCursorPayloadEdges,
  testDecideStopAllowsEveryUnknown,
  testDecideStopBlocksUngradedCommits,
  testStopOutputShapesPerClient,
  testStopPayloadsMapToSameDecision,
  testUtcStampMatchesSqliteFormat,
} from "./hook.test.js";
import {
  testInitCreatesDirectories,
  testInitIdempotent,
  testInitNoArgs,
  testInitSnippetPathMatchesScaffold,
} from "./init.test.js";
// Install tests (split into test/install/)
import {
  testClaudeAddUsesAbsolutePath,
  testClaudeGetPointsToFapony,
  testCmdInstallDispatchesClaude,
  testInstallClaudeAbsentAdds,
  testInstallClaudeAddFailureHintsHelp,
  testInstallClaudeAlreadyConfiguredNoOp,
  testInstallClaudeDifferentCommandRefusesOverwrite,
  testInstallClaudeDryRunNeverAdds,
  testInstallClaudeForeignScriptRefusesOverwrite,
  testInstallClaudeForeignStatuslineRefusesOverwrite,
  testInstallClaudeMissingBinary,
  testInstallClaudeStatuslineWiresSettings,
  testInstallClaudeStopHookAppendsOnceAndKeepsForeign,
} from "./install/claude.test.js";
import {
  testCmdInstallDispatchesCodex,
  testInstallCodexAlreadyConfiguredNoOp,
  testInstallCodexAppendsEntry,
  testInstallCodexDryRunNoWrite,
  testInstallCodexNoConfigFails,
} from "./install/codex.test.js";
import {
  testCmdInstallDispatchesCursor,
  testInstallCursorAlreadyConfiguredNoOp,
  testInstallCursorDryRunNoWrite,
  testInstallCursorForeignMcpRefuses,
  testInstallCursorFreshWritesMcpAndHooks,
  testInstallCursorMergesStopHookKeepsOthers,
  testInstallCursorNoDirFails,
} from "./install/cursor.test.js";
import {
  testDetectClientsAllFound,
  testDetectClientsMixed,
  testDetectClientsNoneFound,
} from "./install/detect.test.js";
import {
  testCmdInstallNoClientsFoundPrintsHelp,
  testCmdInstallNonTtyNoAllSkipsInstall,
  testCmdInstallNoPlatformAllFlag,
  testCmdInstallNoPlatformDryRunNoWrite,
  testCmdInstallNoPlatformPromptsDetected,
  testCmdInstallRejectsUnknownPlatform,
} from "./install/dispatch.test.js";
import { testInstallRootIsRepoRoot } from "./install/helpers.test.js";
import {
  testCmdInstallDispatchesOpencode,
  testInstallOpencodeAlreadyConfiguredLinksSkills,
  testInstallOpencodeAlreadyConfiguredNoOp,
  testInstallOpencodeDryRunNoWrite,
  testInstallOpencodeNewFile,
  testInstallOpencodeParseErrorFails,
} from "./install/opencode.test.js";
import {
  testLinkSkillsCreatesSymlinks,
  testLinkSkillsDryRunNoWrite,
  testLinkSkillsIdempotent,
  testLinkSkillsRefusesOverwrite,
} from "./install/skills.test.js";
import {
  testCmdInstallDispatchesZcode,
  testInstallZcodeAlreadyConfiguredLinksSkills,
  testInstallZcodeAlreadyConfiguredNoOp,
  testInstallZcodeDryRunNoWrite,
  testInstallZcodeFallbackPath,
  testInstallZcodeLinksSkillsIntoAgentsDir,
  testInstallZcodeNoConfigFails,
  testInstallZcodePrimaryPath,
} from "./install/zcode.test.js";
import {
  testMapDirCap,
  testMapDirListing,
  testMapExtractExports,
  testMapExtractExportsParseError,
  testMapExtractIgnoresSampleText,
  testMapExtractMultilineTypeBlock,
  testMapExtractVarDeclaratorLists,
  testMapFileAndBroken,
  testMapFileShowsSignature,
  testMapMissingPath,
} from "./map.test.js";
// MCP handcheck tests (split into test/mcp/)
import {
  testExtractMultiFieldEmptyLineEndsField,
  testExtractMultiFieldMultiLine,
  testExtractMultiFieldNone,
  testExtractMultiFieldNotFound,
  testExtractMultiFieldSingle,
  testHandoffCheckAutoGenerate,
  testHandoffCheckAutoGenerateRequiresAgentReport,
  testHandoffCheckAutoGenerateWithUncertainty,
  testHandoffCheckBlastRadiusWithWorktree,
  testHandoffCheckGoodHandoff,
  testHandoffCheckMissingBlock,
  testHandoffCheckMultiLineUncertain,
  testHandoffCheckNoBlastRadiusWithoutWorktree,
  testHandoffCheckNotDoneFails,
  testHandoffCheckUncertainFails,
  testHandoffCheckWithFactsCrossRef,
  testHandoffCheckWithoutFacts,
} from "./mcp/check.test.js";
import {
  testHandoffCollectAheadBehind,
  testHandoffCollectAutoDetectRange,
  testHandoffCollectExplicitRange,
  testHandoffCollectGitError,
  testHandoffCollectMissingArgs,
  testHandoffCollectReturnsFiles,
  testHandoffCollectValidRepo,
} from "./mcp/collect.test.js";
import {
  testCollectEvidenceAgentCommands,
  testCollectEvidenceAgentDuplicatesAllowlist,
  testCollectEvidenceAppScoped,
  testCollectEvidenceFailingCommand,
  testCollectEvidenceInvalidEntry,
  testCollectEvidenceNoConfig,
  testCollectEvidencePassingCommand,
  testCollectEvidenceRefusesDangerousCommand,
  testCollectEvidenceTimeout,
  testReadEvidenceConfigCustomPath,
  testReadEvidenceConfigInvalid,
  testReadEvidenceConfigMissing,
  testReadEvidenceConfigValid,
  testResolveEvidencePathAppScoped,
  testResolveEvidencePathCustomConfigWins,
  testResolveEvidencePathEmptyFallsBackToRoot,
  testResolveEvidencePathMissingAppFileFallsBackToRoot,
  testResolveEvidencePathMixedFallsBackToRoot,
} from "./mcp/evidence.test.js";
import {
  testEndToEndPipeline,
  testErrorResult,
  testJsonResult,
  testParseToolResult,
  testReasonCodesAreLocked,
  testRegimeCodesAreLocked,
} from "./mcp/helpers.test.js";
import {
  testPlanListGroupsByFrontmatter,
  testPlanListJoinsRunHistory,
  testPlanListLegacyArchiveLocation,
  testPlanListMissingDir,
  testPlanListNeverAttempted,
  testPlanListProgressAndMarkdown,
  testPlanListRequiresWorktree,
  testPlanListUsesWorktreeConfigPaths,
} from "./mcp/plans.test.js";
import {
  testComputeEvidenceSummaryEmpty,
  testComputeEvidenceSummaryMixed,
  testEvidenceStatusesAreLocked,
  testRenderReportTextGitError,
  testRenderReportTextMinimal,
  testRenderReportTextWithFailingEvidence,
  testRenderReportTextWithHandoffChecks,
  testRenderReportTextWithPassedVerdict,
} from "./mcp/primitives.test.js";
import {
  testVerificationReportCheckParity,
  testVerificationReportJsonFormat,
  testVerificationReportMissingArgs,
  testVerificationReportRunNotFound,
  testVerificationReportSurfacesCollectError,
  testVerificationReportTextFormat,
  testVerificationReportToolCount,
  testVerificationReportVerdictFromGateEvent,
  testVerificationReportWorktreeOnlyCreatesNoRun,
} from "./mcp/report.test.js";
import {
  testStatsTextMatchesCli,
  testStatsToolByGradeSeparation,
  testStatsToolEmptyDb,
  testStatsToolGroupByInvalid,
  testStatsToolGroupByPlan,
  testStatsToolGroupByPlanWorktreeScoped,
  testStatsToolGroupByReasonCode,
  testStatsToolJsonMode,
  testStatsToolTextMode,
} from "./mcp/stats.test.js";
import {
  testMcpInitialize,
  testMcpNotificationsIgnored,
  testMcpToolsCallUnknownTool,
  testMcpToolsList,
  testMcpUnknownMethod,
} from "./mcp/transport.test.js";
import {
  testUsageDefaultRegression,
  testUsageDetailJson,
  testUsageDetailText,
} from "./mcp/usage.test.js";
import {
  testVerdictSubmitAllGrades,
  testVerdictSubmitAutoCreatesRun,
  testVerdictSubmitInvalidReasonCode,
  testVerdictSubmitInvalidRegimeRejects,
  testVerdictSubmitInvalidVerdict,
  testVerdictSubmitMissingRegimeRejects,
  testVerdictSubmitNullPlanAlwaysCreatesNew,
  testVerdictSubmitOtherRequiresNote,
  testVerdictSubmitPassedRunNotReused,
  testVerdictSubmitRegimeStoredInGateEvent,
  testVerdictSubmitReusesOpenRunAcrossRounds,
  testVerdictSubmitRunNotFound,
  testVerdictSubmitStoresMcpSource,
  testVerdictSubmitSuccess,
} from "./mcp/verdict.test.js";
import {
  testResolveWorktreeArgAbsolutePath,
  testResolveWorktreeArgKeyLookup,
  testResolveWorktreeArgKeyNotFound,
  testResolveWorktreeArgSentinel,
} from "./mcp/worktree.test.js";
import {
  testClaimMemoryFailGracefully,
  testClaimMemoryTimeout,
  testMemoryDefaultWiringNoFile,
  testMemoryDefaultWiringWithFile,
  testMemoryExplicitConfigWins,
  testMemoryReadRecentDecisions,
  testMemoryReadRecentDecisionsMonorepo,
} from "./memory.test.js";
import {
  testMemTemplateCentralCopyMovedIntoFapony,
  testMemTemplateConfigStillWins,
  testMemTemplateInitAtMonorepoRoot,
  testMemTemplateMonorepoLegacyLog,
  testMemTemplateMonorepoMigratedApp,
  testMemTemplateMonorepoUnmigratedApp,
  testMemTemplatePackagesApp,
  testMemTemplatePerPersonLogs,
  testMemTemplateScaffolded,
  testMemTemplateScaffoldedIgnoresRootConfig,
  testMemTemplateSingleRepoCentralDefaultsToFapony,
  testMemTemplateSingleRepoLegacyLog,
  testMemTemplateSingleRepoWithPackagesDir,
  testMemTemplateUnknownAppFails,
} from "./memory-template.test.js";
import {
  testFixtureGuard,
  testParseGateEventData,
  testQualityScore,
} from "./parse.test.js";
import {
  testPlanSeedCapsHold,
  testPlanSeedConfigFallback,
  testPlanSeedNoOverwrite,
  testPlanSeedRepetitionCluster,
  testPlanSeedScopeFilters,
  testPlanSeedSpecSignatures,
  testPlanSeedWritesPlan,
} from "./plan-seed.test.js";
import {
  testCalcCostCacheWriteFallsBackToInput,
  testCalcCostUsesCacheReadRate,
  testFetchPriceTableStub,
  testImputeBuckets,
  testLoadPricesMissingIsNull,
  testMergeKeepsOldIds,
  testParsePricesStripsTildeAndKeepsFreeIds,
  testResolveBareSlugAndLocal,
  testResolveDirectAndOpenrouterPrefix,
  testResolveUnpricedIsNotZero,
  testResolveVendorPrefixAndFreeSuffix,
  testWriteLoadRoundtrip,
} from "./price.test.js";
import {
  testReportHtmlByModelHasAttributionColumns,
  testReportHtmlByModelProjectColumn,
  testReportHtmlCanonicalQuality,
  testReportHtmlEscapesContent,
  testReportHtmlFiltersAndMethodology,
  testReportWebWarnsOnlyWhenCommittable,
} from "./report-html.test.js";
import {
  testReviewSeedDeterministicAndNoWrite,
  testReviewSeedNotARepo,
  testReviewSeedPlanCrossCheck,
  testReviewSeedRenames,
  testReviewSeedScopeFlags,
  testReviewSeedStateDbUntouched,
  testReviewSeedStructure,
} from "./review-seed.test.js";
import { testAssertSafe } from "./safety.test.js";
import {
  testBeginSnapshotOnlyUnderWal,
  testMergeBytesByToolSumsAcrossClients,
  testReadClaudeCodeUsageFilterByWorktree,
  testReadClaudeCodeUsageNoDir,
  testReadClaudeCodeUsagePrimaryPath,
  testReadClaudeCodeUsageSkipsMalformedLines,
  testReadClaudeCodeUsageStaleReads,
  testReadCodexUsageDetailBytesByTool,
  testReadCodexUsageFilterByWorktree,
  testReadCodexUsageNoDir,
  testReadCodexUsagePrimaryPath,
  testReadCodexUsageSkipsMalformedLines,
  testReadZcodeUsageDetail,
  testReadZcodeUsageFilterByWorktree,
  testReadZcodeUsageNoDb,
  testReadZcodeUsagePrimaryPath,
  testSessionDefaultHasNoDetail,
  testSessionDetailBreakdown,
  testSessionDetailBytesByTool,
  testSessionDetailMatchesRawSql,
  testSessionDetailSkipsUnknownType,
  testSessionDetailStepTokensNotSummed,
  testSessionReadFailureReportsErrorCode,
  testSessionWorktreeScopeUsesSessionDirectory,
} from "./session.test.js";
import {
  testBuildSetupConfigNoMemory,
  testBuildSetupConfigWithMemory,
  testCmdSetupBunMissing,
  testCmdSetupGitMissing,
  testCmdSetupHappyPathScaffolds,
  testCmdSetupInvalidPath,
  testCmdSetupOverwriteNoKeepsFile,
  testCmdSetupOverwriteYesWritesThrough,
  testCmdSetupScaffoldAlreadyExists,
  testShouldOverwriteConfig,
  testValidateWorktreePath,
  testValidateWorktreePathRejectsFile,
} from "./setup.test.js";
import {
  testCountPendingPlans,
  testStatsBestPassing,
  testStatsByFileRisk,
  testStatsByModelGroupsByClientProviderAgent,
  testStatsByPlanModeSplit,
  testStatsByRegimeSplit,
  testStatsByWorktree,
  testStatsEmptyDb,
  testStatsEscalatedRuns,
  testStatsLegacyPassMergedWithPassAdequate,
  testStatsModelFromExecutorSpawn,
  testStatsModelFromSessionIdWhenNoSpawn,
  testStatsMultiRoundSeparateGates,
  testStatsPassRateFromVerdicts,
  testStatsPlanBreakdown,
  testStatsReasonCodeBreakdown,
  testStatsSpawnModelWinsOverSessionId,
  testStatsTokensCountSessionOnce,
  testStatsTokensInByModel,
  testStatsTokensPerPassChargesReworkOnce,
  testStatsTokensPerPassNullWhenNoPass,
  testStatsTokensPerPassNullWithoutTokens,
  testStatsUsageByModelIdentity,
  testStatsUsageCountsCacheAsInput,
  testStatsVerdictNotesNotCappedAtDisplayLimit,
} from "./stats.test.js";
// Telemetry tests (split into test/telemetry/)
import {
  testTelemetryAggregatesFromRuns,
  testTelemetryPerRoundModelMultiRound,
  testTelemetryWorktreeRedacted,
} from "./telemetry/aggregates.test.js";
import {
  testTelemetryDerivedExcludedFromContentCheck,
  testTelemetryDerivedToolCountsScopedToWorktrees,
} from "./telemetry/derived-tools.test.js";
import {
  testTelemetryEmptyDb,
  testTelemetryNoContentFields,
  testTelemetryPayloadShape,
  testTelemetrySchemaVersion,
  testTelemetrySentAtIso,
} from "./telemetry/payload.test.js";
import {
  testTelemetrySelfReportedFromConfig,
  testTelemetrySelfReportedRoundTrip,
} from "./telemetry/self-reported.test.js";
import {
  testClaudeCodeTimingDetail,
  testCollectTimingStepCountMirrorsDetail,
  testExtractPartTimingMalformed,
  testExtractPartTimingStepFinish,
  testExtractPartTimingToolPart,
  testOpenCodeTimingFromEmbedded,
  testOpenCodeTimingNeverLeaksIO,
  testParseTimeMsUnits,
  testRowFallbackMsVariants,
  testSummarizeTimingAverages,
  testSummarizeTimingEmpty,
  testZcodeTimingEmbeddedOnly,
} from "./timing.test.js";
import {
  testCmdUpdateAlreadyUpToDate,
  testCmdUpdateDirtyDeclined,
  testCmdUpdateDirtyPullOk,
  testCmdUpdateInstallFailureWarns,
  testCmdUpdateLockfileTriggersInstall,
  testCmdUpdateNotARepo,
  testCmdUpdatePullFailPopFail,
  testCmdUpdatePullFailPopOk,
  testFormatDirtyBlock,
  testIsUpToDate,
  testParseDirtyLines,
  testShouldProceedAfterDirty,
  testUpdateReadVersionResolves,
  testUpdateRootIsRepoRoot,
} from "./update.test.js";
import {
  testCacheMetaCalculatesOldest,
  testCacheMetaEmpty,
  testCacheMetaProjectDimension,
  testFmtCostNull,
  testFmtCostPositive,
  testFmtCostZero,
  testFmtDeltaNegative,
  testFmtDeltaPositive,
  testFmtDeltaZero,
  testFmtTokensMillions,
  testFmtTokensThousands,
  testFmtTokensZero,
  testMergeEntriesDedup,
  testRenderHtmlCostWide,
  testRenderHtmlFreshnessBar,
  testRenderHtmlHidesEmptyCard,
  testRenderHtmlImputedCost,
  testRenderHtmlModelNames,
  testRenderHtmlNoData,
  testRenderHtmlNoPollInterval,
  testRenderHtmlNoPricesHint,
  testRenderHtmlReadErrorBadge,
  testRenderHtmlShareSection,
  testRenderHtmlStructure,
  testRenderHtmlSummaryCards,
  testRenderHtmlTokenValues,
  testRenderHtmlTotalsColumnCount,
  testShortModelEmptyString,
  testShortModelJsonId,
  testShortModelJsonNoId,
  testShortModelPlainText,
  testWriteCacheCreatesStateDir,
} from "./usage.test.js";
import { testIsAffirmative } from "./util.test.js";

export async function cmdTest(): Promise<void> {
  // Isolation: point every passive-usage reader at a path that does not exist,
  // so no test scans the developer's live session logs. Without this, anything
  // that calls getStatsData() pays ~2s per call and can read logs a running
  // agent is writing mid-test (nondeterministic — see testStatsTextMatchesCli).
  // A test that needs real usage data sets its own fixture path and restores to
  // this pinned value. Same isolation as test/digest.test.ts.
  process.env.FAPONY_OPENCODE_DB = "/nonexistent/fapony-test/opencode.db";
  process.env.FAPONY_ZCODE_DB = "/nonexistent/fapony-test/zcode.db";
  process.env.FAPONY_CLAUDE_PROJECTS_DIR = "/nonexistent/fapony-test/claude";
  process.env.FAPONY_CODEX_SESSIONS_DIR = "/nonexistent/fapony-test/codex";
  console.log("running tests...\n");
  testAssertSafe();
  testAnalyzeHubOrphanCycle();
  testAnalyzeChangedUntested();
  testAnalyzeSkipsUnresolvableAndBroken();
  testAnalyzeEmptyDir();
  testAnalyzeBlastRadius();
  testAnalyzeBlastRadiusTransitive();
  testAnalyzeBlastRadiusTransitiveCycle();
  testAnalyzeIsTestFile();
  testMapExtractExports();
  testMapExtractExportsParseError();
  testMapExtractIgnoresSampleText();
  testMapExtractMultilineTypeBlock();
  testMapExtractVarDeclaratorLists();
  testMapDirListing();
  testMapDirCap();
  testMapFileAndBroken();
  testMapFileShowsSignature();
  testMapMissingPath();
  testPlanSeedWritesPlan();
  testPlanSeedNoOverwrite();
  testPlanSeedSpecSignatures();
  testPlanSeedRepetitionCluster();
  testPlanSeedScopeFilters();
  testPlanSeedCapsHold();
  testPlanSeedConfigFallback();
  testReviewSeedScopeFlags();
  testReviewSeedStructure();
  testReviewSeedRenames();
  testReviewSeedDeterministicAndNoWrite();
  testReviewSeedPlanCrossCheck();
  testReviewSeedNotARepo();
  testReviewSeedStateDbUntouched();
  testDecideStopBlocksUngradedCommits();
  testDecideStopAllowsEveryUnknown();
  testStopPayloadsMapToSameDecision();
  testCursorPayloadEdges();
  testStopOutputShapesPerClient();
  testUtcStampMatchesSqliteFormat();
  testDbLifecycle();
  testSchemaVersionStamped();
  testLegacyDbStampedWithoutDataLoss();
  testMigrateDbRejectsNewerSchema();
  testParseGateEventData();
  testFixtureGuard();
  testQualityScore();
  testGateOncePass();
  testGateOnceFail();
  testGateOnceAlreadyPassed();
  testGateOnceAlreadyStalled();
  testGateOnceMaxRounds();
  testGateOncePassExcellent();
  testGateOncePassGood();
  testGateOncePassAdequate();
  testGateOnceUncertain();
  testFindSessionModelOpenCodeHit();
  testFindSessionModelOpenCodeMiss();
  testFindSessionModelZcodeHit();
  testFindSessionModelZcodeMiss();
  testFindSessionModelZcodeMultiModel();
  testFindSessionModelZcodeSummedTokensWin();
  testFindSessionModelZcodeRawProviderPassthrough();
  testFindSessionModelOpenCodePlainTextProviderUnknown();
  testFindSessionModelClaudeCodeHit();
  testFindSessionModelClaudeCodeMiss();
  testFindSessionModelClaudeCodeMajority();
  testFindSessionModelClaudeCodeTieGoesLast();
  testFindSessionModelCodexHit();
  testFindSessionModelCodexMiss();
  testFindSessionModelCodexMultiMeta();
  testFindSessionModelCodexMultiMetaTieGoesLast();
  testFindSessionModelEmptyId();
  testFindSessionModelNoReadersAvailable();
  testInitCreatesDirectories();
  testInitIdempotent();
  testInitNoArgs();
  testInitSnippetPathMatchesScaffold();
  testMemoryDefaultWiringWithFile();
  testMemoryDefaultWiringNoFile();
  testMemoryExplicitConfigWins();
  testMemTemplateMonorepoMigratedApp();
  testMemTemplateMonorepoLegacyLog();
  testMemTemplateSingleRepoCentralDefaultsToFapony();
  testMemTemplateSingleRepoLegacyLog();
  testMemTemplatePackagesApp();
  testMemTemplateSingleRepoWithPackagesDir();
  testMemTemplateMonorepoUnmigratedApp();
  testMemTemplateConfigStillWins();
  testMemTemplateCentralCopyMovedIntoFapony();
  testMemTemplateScaffolded();
  testMemTemplateInitAtMonorepoRoot();
  testMemTemplatePerPersonLogs();
  testMemTemplateScaffoldedIgnoresRootConfig();
  testMemTemplateUnknownAppFails();
  testClaimMemoryFailGracefully();
  testMemoryReadRecentDecisions();
  testMemoryReadRecentDecisionsMonorepo();
  // Digest tests
  await testDigestEmptyRepo();
  await testDigestSinceFilter();
  await testDigestEscInjection();
  await testDigestMalformedLine();
  await testDigestJsonSubsetOfText();
  await testDigestInvalidSince();
  await testDigestPlanProgress();
  await testDigestBugOpenClose();
  // ponytail: real ~15s execSync timeout regression test — skip in the fast
  // dev loop, keep it for CI/pre-commit (bun fapony.ts test, no SKIP_SLOW).
  if (!process.env.SKIP_SLOW) testClaimMemoryTimeout();
  else console.log("  ⏭ claimMemory timeout prevents hang (SKIP_SLOW)");
  testConfigDefaults();
  testConfigFileOverrides();
  testConfigUnknownKeysRideAlong();
  testCustomSafetyDeny();
  testTemplateArgsReplaceAll();
  testBuildSetupConfigNoMemory();
  testBuildSetupConfigWithMemory();
  testValidateWorktreePath();
  testValidateWorktreePathRejectsFile();
  testShouldOverwriteConfig();
  await testCmdSetupGitMissing();
  await testCmdSetupBunMissing();
  await testCmdSetupInvalidPath();
  await testCmdSetupOverwriteNoKeepsFile();
  await testCmdSetupOverwriteYesWritesThrough();
  await testCmdSetupHappyPathScaffolds();
  await testCmdSetupScaffoldAlreadyExists();
  testIsAffirmative();
  testParseTimeMsUnits();
  testExtractPartTimingToolPart();
  testExtractPartTimingStepFinish();
  testExtractPartTimingMalformed();
  testRowFallbackMsVariants();
  testSummarizeTimingAverages();
  testSummarizeTimingEmpty();
  testOpenCodeTimingFromEmbedded();
  testOpenCodeTimingNeverLeaksIO();
  testCollectTimingStepCountMirrorsDetail();
  testZcodeTimingEmbeddedOnly();
  testClaudeCodeTimingDetail();
  testContextBlockSnapshot();
  testContextBlockLowHistory();
  testContextBlockWorktreeScope();
  testContextBlockNoPatterns();
  testContextBlockLineCap();
  testContextBlockRecentNotes();
  testContextBlockFilesFilterBeyondTop3();
  testContextBlockLowHistoryStillShowsNotes();
  testContextToolEndToEnd();
  testContextToolEmptyDb();
  testComputeModelFit();
  testContextBlockMemDecisions();
  testContextBlockModelFitLine();
  testContextBlockMergesReasonsAcrossWorktrees();
  testContextBlockNoteCapAndNoneTag();
  testContextBlockHubLine();
  testContextBlockHubLowHistory();
  testContextBlockHubSilentBelowThreshold();
  testContextBlockHubCapHolds();
  testContextToolHubEndToEnd();
  testParseDirtyLines();
  testFormatDirtyBlock();
  testShouldProceedAfterDirty();
  testIsUpToDate();
  testUpdateRootIsRepoRoot();
  testUpdateReadVersionResolves();
  await testCmdUpdateNotARepo();
  await testCmdUpdateDirtyDeclined();
  await testCmdUpdateDirtyPullOk();
  await testCmdUpdatePullFailPopOk();
  await testCmdUpdatePullFailPopFail();
  await testCmdUpdateAlreadyUpToDate();
  await testCmdUpdateLockfileTriggersInstall();
  await testCmdUpdateInstallFailureWarns();
  testInstallRootIsRepoRoot();
  testClaudeAddUsesAbsolutePath();
  testClaudeGetPointsToFapony();
  testInstallClaudeAbsentAdds();
  testInstallClaudeAlreadyConfiguredNoOp();
  testInstallClaudeDifferentCommandRefusesOverwrite();
  testInstallClaudeForeignStatuslineRefusesOverwrite();
  testInstallClaudeStopHookAppendsOnceAndKeepsForeign();
  testInstallClaudeForeignScriptRefusesOverwrite();
  testInstallClaudeStatuslineWiresSettings();
  testInstallClaudeDryRunNeverAdds();
  testInstallClaudeMissingBinary();
  testInstallClaudeAddFailureHintsHelp();
  testCmdInstallDispatchesClaude();
  testLinkSkillsCreatesSymlinks();
  testLinkSkillsIdempotent();
  testLinkSkillsRefusesOverwrite();
  testLinkSkillsDryRunNoWrite();
  testCmdInstallRejectsUnknownPlatform();
  testInstallOpencodeNewFile();
  testInstallOpencodeAlreadyConfiguredNoOp();
  testInstallOpencodeAlreadyConfiguredLinksSkills();
  testInstallOpencodeDryRunNoWrite();
  testInstallOpencodeParseErrorFails();
  testCmdInstallDispatchesOpencode();
  testInstallCodexNoConfigFails();
  testInstallCodexAppendsEntry();
  testInstallCodexAlreadyConfiguredNoOp();
  testInstallCodexDryRunNoWrite();
  testCmdInstallDispatchesCodex();
  testInstallCursorNoDirFails();
  testInstallCursorFreshWritesMcpAndHooks();
  testInstallCursorMergesStopHookKeepsOthers();
  testInstallCursorForeignMcpRefuses();
  testInstallCursorAlreadyConfiguredNoOp();
  testInstallCursorDryRunNoWrite();
  testCmdInstallDispatchesCursor();
  testInstallZcodeNoConfigFails();
  testInstallZcodePrimaryPath();
  testInstallZcodeFallbackPath();
  testInstallZcodeAlreadyConfiguredNoOp();
  testInstallZcodeAlreadyConfiguredLinksSkills();
  testInstallZcodeDryRunNoWrite();
  testInstallZcodeLinksSkillsIntoAgentsDir();
  testCmdInstallDispatchesZcode();
  // detect + prompt tests
  testDetectClientsAllFound();
  testDetectClientsNoneFound();
  testDetectClientsMixed();
  await testCmdInstallNoPlatformPromptsDetected();
  await testCmdInstallNoPlatformAllFlag();
  await testCmdInstallNonTtyNoAllSkipsInstall();
  testCmdInstallNoClientsFoundPrintsHelp();
  await testCmdInstallNoPlatformDryRunNoWrite();
  // MCP handcheck tests
  testMcpInitialize();
  testMcpToolsList();
  testMcpNotificationsIgnored();
  testMcpUnknownMethod();
  testMcpToolsCallUnknownTool();
  testStatsToolEmptyDb();
  testStatsToolJsonMode();
  testStatsToolTextMode();
  testStatsTextMatchesCli();
  testStatsToolByGradeSeparation();
  testStatsToolGroupByReasonCode();
  testStatsToolGroupByPlan();
  testStatsToolGroupByPlanWorktreeScoped();
  testStatsToolGroupByInvalid();
  testUsageDefaultRegression();
  testUsageDetailJson();
  testUsageDetailText();
  testHandoffCollectMissingArgs();
  testHandoffCollectAutoDetectRange();
  testHandoffCollectExplicitRange();
  testHandoffCollectReturnsFiles();
  testHandoffCollectAheadBehind();
  testHandoffCollectValidRepo();
  testHandoffCollectGitError();
  testHandoffCheckMissingBlock();
  testHandoffCheckGoodHandoff();
  testHandoffCheckUncertainFails();
  testHandoffCheckNotDoneFails();
  testHandoffCheckAutoGenerate();
  testHandoffCheckAutoGenerateRequiresAgentReport();
  testHandoffCheckAutoGenerateWithUncertainty();
  testHandoffCheckBlastRadiusWithWorktree();
  testHandoffCheckNoBlastRadiusWithoutWorktree();
  testHandoffCheckWithFactsCrossRef();
  testHandoffCheckWithoutFacts();
  testHandoffCheckMultiLineUncertain();
  testVerdictSubmitInvalidVerdict();
  testVerdictSubmitInvalidReasonCode();
  testVerdictSubmitOtherRequiresNote();
  testVerdictSubmitRunNotFound();
  testVerdictSubmitSuccess();
  testVerdictSubmitStoresMcpSource();
  testVerdictSubmitAutoCreatesRun();
  testVerdictSubmitAllGrades();
  testVerdictSubmitReusesOpenRunAcrossRounds();
  testVerdictSubmitNullPlanAlwaysCreatesNew();
  testVerdictSubmitPassedRunNotReused();
  testVerdictSubmitMissingRegimeRejects();
  testVerdictSubmitInvalidRegimeRejects();
  testVerdictSubmitRegimeStoredInGateEvent();
  testPlanListRequiresWorktree();
  testPlanListMissingDir();
  testPlanListNeverAttempted();
  testPlanListJoinsRunHistory();
  testPlanListUsesWorktreeConfigPaths();
  testPlanListGroupsByFrontmatter();
  testPlanListProgressAndMarkdown();
  testPlanListLegacyArchiveLocation();
  testEndToEndPipeline();
  testExtractMultiFieldNone();
  testExtractMultiFieldSingle();
  testExtractMultiFieldMultiLine();
  testExtractMultiFieldEmptyLineEndsField();
  testExtractMultiFieldNotFound();
  testJsonResult();
  testErrorResult();
  testParseToolResult();
  testReasonCodesAreLocked();
  testRegimeCodesAreLocked();
  // Verification primitives tests
  testEvidenceStatusesAreLocked();
  testComputeEvidenceSummaryEmpty();
  testComputeEvidenceSummaryMixed();
  testRenderReportTextMinimal();
  testRenderReportTextWithPassedVerdict();
  testRenderReportTextWithFailingEvidence();
  testRenderReportTextWithHandoffChecks();
  testRenderReportTextGitError();
  // Evidence collector tests
  testReadEvidenceConfigMissing();
  testReadEvidenceConfigInvalid();
  testReadEvidenceConfigValid();
  testReadEvidenceConfigCustomPath();
  testCollectEvidenceNoConfig();
  testCollectEvidencePassingCommand();
  testCollectEvidenceFailingCommand();
  testCollectEvidenceAgentCommands();
  testCollectEvidenceAgentDuplicatesAllowlist();
  testCollectEvidenceTimeout();
  testCollectEvidenceRefusesDangerousCommand();
  testCollectEvidenceInvalidEntry();
  testResolveEvidencePathAppScoped();
  testResolveEvidencePathMixedFallsBackToRoot();
  testResolveEvidencePathEmptyFallsBackToRoot();
  testResolveEvidencePathMissingAppFileFallsBackToRoot();
  testResolveEvidencePathCustomConfigWins();
  testCollectEvidenceAppScoped();
  // Verification report tool tests
  testVerificationReportMissingArgs();
  testVerificationReportRunNotFound();
  testVerificationReportTextFormat();
  testVerificationReportJsonFormat();
  testVerificationReportToolCount();
  testVerificationReportWorktreeOnlyCreatesNoRun();
  testVerificationReportVerdictFromGateEvent();
  testVerificationReportCheckParity();
  testVerificationReportSurfacesCollectError();
  // Stats enrichment tests
  testStatsEmptyDb();
  testStatsVerdictNotesNotCappedAtDisplayLimit();
  testCountPendingPlans();
  testStatsMultiRoundSeparateGates();
  testStatsLegacyPassMergedWithPassAdequate();
  testStatsByWorktree();
  testStatsReasonCodeBreakdown();
  testStatsUsageByModelIdentity();
  testStatsEscalatedRuns();
  testStatsPlanBreakdown();
  testFindSessionAt();
  testClaudeProjectSlug();
  testStatsBestPassing();
  testStatsByFileRisk();
  testStatsPassRateFromVerdicts();
  testStatsModelFromExecutorSpawn();
  testStatsModelFromSessionIdWhenNoSpawn();
  testStatsByModelGroupsByClientProviderAgent();
  testStatsSpawnModelWinsOverSessionId();
  testStatsByPlanModeSplit();
  testStatsUsageCountsCacheAsInput();
  testStatsByRegimeSplit();
  testStatsTokensInByModel();
  testStatsTokensCountSessionOnce();
  testStatsTokensPerPassChargesReworkOnce();
  testStatsTokensPerPassNullWhenNoPass();
  testStatsTokensPerPassNullWithoutTokens();
  testSessionDefaultHasNoDetail();
  testSessionDetailBreakdown();
  testSessionDetailBytesByTool();
  testSessionWorktreeScopeUsesSessionDirectory();
  testSessionDetailSkipsUnknownType();
  testSessionDetailStepTokensNotSummed();
  testSessionDetailMatchesRawSql();
  testMergeBytesByToolSumsAcrossClients();
  testSessionReadFailureReportsErrorCode();
  testBeginSnapshotOnlyUnderWal();
  testReadZcodeUsageNoDb();
  testReadZcodeUsagePrimaryPath();
  testReadZcodeUsageDetail();
  testReadZcodeUsageFilterByWorktree();
  testReadClaudeCodeUsageNoDir();
  testReadClaudeCodeUsagePrimaryPath();
  testReadClaudeCodeUsageFilterByWorktree();
  testReadClaudeCodeUsageSkipsMalformedLines();
  testReadClaudeCodeUsageStaleReads();
  testReadCodexUsageNoDir();
  testReadCodexUsagePrimaryPath();
  testReadCodexUsageDetailBytesByTool();
  testReadCodexUsageFilterByWorktree();
  testReadCodexUsageSkipsMalformedLines();
  // Telemetry tests
  testTelemetrySchemaVersion();
  testTelemetryPayloadShape();
  testTelemetryNoContentFields();
  testTelemetryEmptyDb();
  testTelemetryAggregatesFromRuns();
  testTelemetryWorktreeRedacted();
  testTelemetrySelfReportedFromConfig();
  testTelemetrySentAtIso();
  testTelemetryPerRoundModelMultiRound();
  testTelemetrySelfReportedRoundTrip();
  testTelemetryDerivedToolCountsScopedToWorktrees();
  testTelemetryDerivedExcludedFromContentCheck();
  testReportHtmlCanonicalQuality();
  testReportHtmlFiltersAndMethodology();
  testReportHtmlByModelHasAttributionColumns();
  testReportHtmlByModelProjectColumn();
  testReportHtmlEscapesContent();
  testReportWebWarnsOnlyWhenCommittable();
  // Usage-web tests
  testFmtTokensZero();
  testFmtTokensThousands();
  testFmtTokensMillions();
  testFmtCostNull();
  testFmtCostZero();
  testFmtCostPositive();
  testFmtDeltaZero();
  testFmtDeltaPositive();
  testFmtDeltaNegative();
  testShortModelJsonId();
  testShortModelJsonNoId();
  testShortModelPlainText();
  testShortModelEmptyString();
  testResolveWorktreeArgAbsolutePath();
  testResolveWorktreeArgKeyLookup();
  testResolveWorktreeArgKeyNotFound();
  testResolveWorktreeArgSentinel();
  // Cache tests
  testMergeEntriesDedup();
  testCacheMetaEmpty();
  testCacheMetaCalculatesOldest();
  testCacheMetaProjectDimension();
  testWriteCacheCreatesStateDir();
  // Imputed-price tests (PLAN-imputed-price — no network, fixture only)
  testParsePricesStripsTildeAndKeepsFreeIds();
  testResolveDirectAndOpenrouterPrefix();
  testResolveVendorPrefixAndFreeSuffix();
  testResolveBareSlugAndLocal();
  testResolveUnpricedIsNotZero();
  testCalcCostUsesCacheReadRate();
  testCalcCostCacheWriteFallsBackToInput();
  testMergeKeepsOldIds();
  testLoadPricesMissingIsNull();
  testWriteLoadRoundtrip();
  await testFetchPriceTableStub();
  testImputeBuckets();
  // Render tests
  testRenderHtmlStructure();
  testRenderHtmlModelNames();
  testRenderHtmlTokenValues();
  testRenderHtmlNoData();
  testRenderHtmlReadErrorBadge();
  testRenderHtmlSummaryCards();
  testRenderHtmlCostWide();
  testRenderHtmlFreshnessBar();
  testRenderHtmlHidesEmptyCard();
  testRenderHtmlNoPollInterval();
  testRenderHtmlShareSection();
  testRenderHtmlImputedCost();
  testRenderHtmlNoPricesHint();
  testRenderHtmlTotalsColumnCount();
  console.log("\nall tests passed ✓");
}
