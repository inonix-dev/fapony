// test/index.ts — test runner. Import all test modules and run sequentially.

import {
  testClaudeProjectSlug,
  testFindSessionAt,
} from "./activeSession.test.js";
import {
  testAnalyzeBlastRadius,
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
  testContextBlockFilesFilterBeyondTop3,
  testContextBlockLineCap,
  testContextBlockLowHistory,
  testContextBlockLowHistoryStillShowsNotes,
  testContextBlockNoPatterns,
  testContextBlockRecentNotes,
  testContextBlockSnapshot,
  testContextBlockWorktreeScope,
  testContextToolEmptyDb,
  testContextToolEndToEnd,
} from "./context.test.js";
import {
  testDbLifecycle,
  testLegacyDbStampedWithoutDataLoss,
  testMigrateDbRejectsNewerSchema,
  testSchemaVersionStamped,
} from "./db.test.js";
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
  testInitCreatesDirectories,
  testInitIdempotent,
  testInitNoArgs,
} from "./init.test.js";
import {
  testClaudeAddUsesAbsolutePath,
  testClaudeGetPointsToFapony,
  testCmdInstallDispatchesClaude,
  testCmdInstallDispatchesCodex,
  testCmdInstallDispatchesOpencode,
  testCmdInstallDispatchesZcode,
  testCmdInstallRejectsUnknownPlatform,
  testInstallClaudeAbsentAdds,
  testInstallClaudeAddFailureHintsHelp,
  testInstallClaudeAlreadyConfiguredNoOp,
  testInstallClaudeDifferentCommandRefusesOverwrite,
  testInstallClaudeDryRunNeverAdds,
  testInstallClaudeForeignScriptRefusesOverwrite,
  testInstallClaudeForeignStatuslineRefusesOverwrite,
  testInstallClaudeMissingBinary,
  testInstallClaudeStatuslineWiresSettings,
  testInstallCodexAlreadyConfiguredNoOp,
  testInstallCodexAppendsEntry,
  testInstallCodexDryRunNoWrite,
  testInstallCodexNoConfigFails,
  testInstallOpencodeAlreadyConfiguredNoOp,
  testInstallOpencodeDryRunNoWrite,
  testInstallOpencodeNewFile,
  testInstallOpencodeParseErrorFails,
  testInstallRootIsRepoRoot,
  testInstallZcodeAlreadyConfiguredNoOp,
  testInstallZcodeDryRunNoWrite,
  testInstallZcodeFallbackPath,
  testInstallZcodeNoConfigFails,
  testInstallZcodePrimaryPath,
  testLinkSkillsCreatesSymlinks,
  testLinkSkillsDryRunNoWrite,
  testLinkSkillsIdempotent,
  testLinkSkillsRefusesOverwrite,
} from "./install.test.js";
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
} from "./memory.test.js";
import {
  testMemTemplateCentralCopyMovedIntoFapony,
  testMemTemplateConfigStillWins,
  testMemTemplateInitAtMonorepoRoot,
  testMemTemplateMonorepoLegacyLog,
  testMemTemplateMonorepoMigratedApp,
  testMemTemplateMonorepoUnmigratedApp,
  testMemTemplatePackagesApp,
  testMemTemplatePerAgentLogs,
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
  testReportHtmlByModelHasAttributionColumns,
  testReportHtmlByModelProjectColumn,
  testReportHtmlCanonicalQuality,
  testReportHtmlEscapesContent,
  testReportHtmlFiltersAndMethodology,
} from "./report-html.test.js";
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
  testStatsUsageByModelIdentity,
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
  testRenderHtmlModelNames,
  testRenderHtmlNoData,
  testRenderHtmlNoPollInterval,
  testRenderHtmlShareSection,
  testRenderHtmlStructure,
  testRenderHtmlSummaryCards,
  testRenderHtmlTokenValues,
  testShortModelEmptyString,
  testShortModelJsonId,
  testShortModelJsonNoId,
  testShortModelPlainText,
  testWriteCacheCreatesStateDir,
} from "./usage.test.js";
import { testIsAffirmative } from "./util.test.js";

export async function cmdTest(): Promise<void> {
  console.log("running tests...\n");
  testAssertSafe();
  testAnalyzeHubOrphanCycle();
  testAnalyzeChangedUntested();
  testAnalyzeSkipsUnresolvableAndBroken();
  testAnalyzeEmptyDir();
  testAnalyzeBlastRadius();
  testAnalyzeIsTestFile();
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
  testMemTemplatePerAgentLogs();
  testMemTemplateScaffoldedIgnoresRootConfig();
  testMemTemplateUnknownAppFails();
  testClaimMemoryFailGracefully();
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
  testInstallOpencodeDryRunNoWrite();
  testInstallOpencodeParseErrorFails();
  testCmdInstallDispatchesOpencode();
  testInstallCodexNoConfigFails();
  testInstallCodexAppendsEntry();
  testInstallCodexAlreadyConfiguredNoOp();
  testInstallCodexDryRunNoWrite();
  testCmdInstallDispatchesCodex();
  testInstallZcodeNoConfigFails();
  testInstallZcodePrimaryPath();
  testInstallZcodeFallbackPath();
  testInstallZcodeAlreadyConfiguredNoOp();
  testInstallZcodeDryRunNoWrite();
  testCmdInstallDispatchesZcode();
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
  testStatsByRegimeSplit();
  testStatsTokensInByModel();
  testStatsTokensCountSessionOnce();
  testSessionDefaultHasNoDetail();
  testSessionDetailBreakdown();
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
  // Render tests
  testRenderHtmlStructure();
  testRenderHtmlModelNames();
  testRenderHtmlTokenValues();
  testRenderHtmlNoData();
  testRenderHtmlSummaryCards();
  testRenderHtmlCostWide();
  testRenderHtmlFreshnessBar();
  testRenderHtmlNoPollInterval();
  testRenderHtmlShareSection();
  console.log("\nall tests passed ✓");
}
