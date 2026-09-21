// test/index.ts — test runner. Import all test modules and run sequentially.

import {
  testClaudeProjectSlug,
  testFindSessionAt,
} from "./activeSession.test.js";
import {
  testAnalyzeBarrelHidesTests,
  testAnalyzeBlastRadius,
  testAnalyzeBlastRadiusTransitive,
  testAnalyzeBlastRadiusTransitiveCycle,
  testAnalyzeChangedUntested,
  testAnalyzeEmptyDir,
  testAnalyzeExportsThroughBarrels,
  testAnalyzeHubOrphanCycle,
  testAnalyzeIsTestFile,
  testAnalyzeSkipsNestedCheckouts,
  testAnalyzeSkipsUnresolvableAndBroken,
  testGraphCacheInProcessInvalidation,
  testGraphCacheWriteThroughInvalidateFallback,
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
} from "./context.test.js";
import {
  testSeedBrokenConfigIsSkippedLoudly,
  testSeedEslintEntriesCarryChecker,
  testSeedEslintSupersetBlocksDedupe,
  testSeedNeverOverwritesExisting,
  testSeedRepoWithoutAnythingGetsEmptyFile,
  testSeedWrapperDetectorFindsLiveMigrations,
} from "./conventions-seed.test.js";
import {
  testDbLifecycle,
  testLegacyDbStampedWithoutDataLoss,
  testMigrateDbRejectsNewerSchema,
  testSchemaVersionStamped,
} from "./db.test.js";
import {
  testDebtCheckerRowsStaySilent,
  testDebtConventionsPathResolution,
  testDebtDerivesListAndDropsWithTheFile,
  testDebtForFileAndMonorepoResolution,
  testDebtPromotionAsksAtThresholdOnly,
  testDebtPromotionCountsLedgerFails,
  testDebtSilentWithoutConventions,
  testDebtTooBroadRegexDropped,
  testDebtWorktreeFollowsThePathNotGitRoot,
} from "./debt.test.js";
import {
  testDetectBunViaPackageManager,
  testDetectBunViaPackageManagerWithTypecheckScript,
  testDetectNpmViaLockfile,
  testDetectNullWhenNoPackageJson,
  testDetectNullWhenPackageJsonHasNoSignal,
  testDetectPnpmViaLockfile,
  testDetectSkipsUnrecognizedPackageManager,
  testDetectYarnViaLockfile,
} from "./detect.test.js";
import {
  testDigestBugOpenClose,
  testDigestEmptyRepo,
  testDigestEscInjection,
  testDigestImpactNoLog,
  testDigestImpactSection,
  testDigestInvalidSince,
  testDigestJsonSubsetOfText,
  testDigestMalformedLine,
  testDigestPlanProgress,
  testDigestSinceFilter,
} from "./digest.test.js";
import {
  testAddingFakeEnumValueFailsDocsCheck,
  testReasonCodesListedInDocs,
  testRegimeCodesListedInDocs,
} from "./docs.test.js";
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
  testCodexNormalizeMapsToSameDecision,
  testCodexPayloadDetection,
  testCodexStopHookActiveAllows,
  testCodexStopOutputShape,
  testCommitHintFiresForCommitsSinceMemRow,
  testCommitHintMinCommitsConstant,
  testCommitHintNullForNonCommit,
  testCommitHintNullOutsideGitRepo,
  testCommitHintPluginSource,
  testCommitHintSilentWhenMemRowCoversCommits,
  testCommitHintSilentWithoutMemLog,
  testComputeHintImpact,
  testComputeHintImpactNoLog,
  testCursorPayloadEdges,
  testDecideStopAllowsEveryUnknown,
  testDecideStopBlocksUngradedCommits,
  testDecideStopComparesProductionTimestampShapes,
  testDecideStopDerivesCommandFromWorktree,
  testDecideStopMemBlocksWhenStale,
  testDecideStopMessageIsRepoNeutral,
  testDecideStopNamesOutOfScopeMemLog,
  testDecideStopReportsCommitsAndMem,
  testEditHintClaudeOutputShape,
  testEditHintDedupesPerSessionPerFile,
  testEditHintFiresWithImporters,
  testEditHintFiresWithoutSession,
  testEditHintNeedsGitRepo,
  testEditHintPluginSource,
  testEditHintSilentZeroImporters,
  testEditHintSkipsNonSourceAndMissing,
  testHookSessionStartSilentWithoutMemLog,
  testReadContextBasenameAmbiguityStaysSilent,
  testReadContextCombinedCapAndOutsideRepo,
  testReadContextMemRowsByFilesAndPath,
  testReadContextShowsDebtBeforeFix,
  testReadHintAnnotatesLargeFullRead,
  testReadHintClaudeOutputShape,
  testReadHintNeedsGitRepo,
  testReadHintPluginSource,
  testReadHintSkipsCheapReads,
  testRereadHintFiresOnUnchangedRepeat,
  testRereadHintKillSwitch,
  testRereadHintSilentAfterEdit,
  testSessionStartContextIsCapped,
  testSessionStartPluginSource,
  testStopBlocksOncePerSessionPerWorktree,
  testStopHookSourceHasNoRepoSpecificCommands,
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
  testCmdInstallDispatchesAntigravity,
  testInstallAntigravityAlreadyConfiguredNoOp,
  testInstallAntigravityDryRunNoWrite,
  testInstallAntigravityForeignMcpRefuses,
  testInstallAntigravityFreshWritesMcpAndSkills,
  testInstallAntigravityMergesExistingServers,
  testInstallAntigravityNoDirFails,
} from "./install/antigravity.test.js";
import {
  testClaudeAddUsesAbsolutePath,
  testClaudeGetPointsToFapony,
  testCmdInstallDispatchesClaude,
  testInstallClaudeAbsentAdds,
  testInstallClaudeAddFailureHintsHelp,
  testInstallClaudeAlreadyConfiguredNoOp,
  testInstallClaudeAlreadyConfiguredStillInstallsHooks,
  testInstallClaudeDifferentCommandRefusesOverwrite,
  testInstallClaudeDryRunNeverAdds,
  testInstallClaudeEditHintAppendsOnce,
  testInstallClaudeMissingBinary,
  testInstallClaudeReadHintAppendsOnce,
  testInstallClaudeStopHookAppendsOnceAndKeepsForeign,
} from "./install/claude.test.js";
import {
  testCmdInstallDispatchesCodex,
  testInstallCodexAlreadyConfiguredNoOp,
  testInstallCodexAppendsEntry,
  testInstallCodexCreatesHooksJson,
  testInstallCodexDryRunHooksNoWrite,
  testInstallCodexDryRunNoWrite,
  testInstallCodexFindHooksJson,
  testInstallCodexHooksAlreadyConfiguredNoOp,
  testInstallCodexHooksMalformedSkipsGracefully,
  testInstallCodexHooksMergePreservesForeign,
  testInstallCodexLinksSkills,
  testInstallCodexNoConfigFails,
  testInstallCodexSessionStartUpgradeAppends,
  testInstallCodexSkillsConflictUntouched,
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
  testInstallOpencodeCommitHintDryRun,
  testInstallOpencodeCommitHintForeignFileUntouched,
  testInstallOpencodeCommitHintIdempotent,
  testInstallOpencodeCommitHintPlugin,
  testInstallOpencodeDryRunNoWrite,
  testInstallOpencodeEditHintDryRun,
  testInstallOpencodeEditHintForeignFileUntouched,
  testInstallOpencodeEditHintPlugin,
  testInstallOpencodeMcpCommandIsAbsolute,
  testInstallOpencodeNewFile,
  testInstallOpencodeParseErrorFails,
  testInstallOpencodeReadHintForeignFileUntouched,
  testInstallOpencodeReadHintPlugin,
  testInstallOpencodeSessionStartDryRun,
  testInstallOpencodeSessionStartForeignFileUntouched,
  testInstallOpencodeSessionStartPlugin,
  testInstallOpencodeSessionStartStaleWarns,
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
  testLintBaselineCaptureAndCleanDiff,
  testLintBaselineDiffReportsOnlyNewFindings,
  testLintBaselineUnixFormatAndErrors,
} from "./lint-baseline.test.js";
import {
  testMapExtractExports,
  testMapExtractExportsParseError,
  testMapExtractIgnoresSampleText,
  testMapExtractMultilineTypeBlock,
  testMapExtractVarDeclaratorLists,
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
  testMemAddRejectsMissingFilesAndBadKind,
  testMemAddWritesWhereMemFindReads,
  testMemCloseRejectsUnknownIdAndEmptyText,
  testMemCloseWritesTombstoneForExistingId,
  testMemFindFiltersAndMatchesFiles,
  testMemFindMatchesStoredFiles,
  testMemFindReturnsAllKindsNoDefaultFilter,
  testMemFindToolValidation,
  testMemFindTotalVsLimitAndFailShapes,
  testMemIdentityNeverCollapsesToUnknown,
} from "./mcp/mem.test.js";
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
  testMcpInitialize,
  testMcpNotificationsIgnored,
  testMcpToolsCallUnknownTool,
  testMcpToolsList,
  testMcpUnknownMethod,
} from "./mcp/transport.test.js";
import {
  testResolveWorktreeArgAbsolutePath,
  testResolveWorktreeArgKeyLookup,
  testResolveWorktreeArgKeyNotFound,
  testResolveWorktreeArgSentinel,
} from "./mcp/worktree.test.js";
import {
  testClaimMemoryFailGracefully,
  testClaimMemoryTimeout,
  testMemDirAmbiguousRefusesWrite,
  testMemDirConfigIsRepoRootRelative,
  testMemDirOverrideWinsAndRefusesMissing,
  testMemDirSingleOutOfScopeReportsCandidate,
  testMemDirSkipsEmptyCandidate,
  testMemDirWalkStopsAtRepoRoot,
  testMemoryDefaultWiringNoDir,
  testMemoryDefaultWiringWithDir,
  testMemoryExplicitConfigWins,
  testMemoryReadRecentDecisions,
  testMemoryReadRecentDecisionsMonorepo,
  testReadMemLogIncludesRotatedArchives,
} from "./memory.test.js";
import {
  testFixtureGuard,
  testParseGateEventData,
  testQualityScore,
} from "./parse.test.js";
import {
  testPlanSeedCapsHold,
  testPlanSeedConfigFallback,
  testPlanSeedNoOverwrite,
  testPlanSeedOverlapScopeDedup,
  testPlanSeedScopeFilters,
  testPlanSeedSingleFileScope,
  testPlanSeedSpecSignatures,
  testPlanSeedStepCloseCarriesLiteralPlanPath,
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
  testReportWebForceOverrides,
  testReportWebRefusesWhenCommittable,
  testReportWebWarnsOnlyWhenCommittable,
} from "./report-html.test.js";
import {
  testReviewSeedBarrelAndScopeList,
  testReviewSeedBodyAndCallers,
  testReviewSeedDeterministicAndNoWrite,
  testReviewSeedFilesDirExpansion,
  testReviewSeedFilesLookupUncapped,
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
  testStatsRegimeTokensSplitNotDuplicated,
  testStatsSpawnModelWinsOverSessionId,
  testStatsTokensCountSessionOnce,
  testStatsTokensInByModel,
  testStatsTokensPerPassChargesReworkOnce,
  testStatsTokensPerPassNullWhenNoPass,
  testStatsTokensPerPassNullWithoutTokens,
  testStatsUsageByModelIdentity,
  testStatsUsageCountsCacheAsInput,
  testStatsVerdictNotesNotCappedAtDisplayLimit,
  testVerdictDominatedRowNamesDominator,
  testVerdictNoRegimeShowsOneLinerPerRegime,
  testVerdictSingleModelShowsDash,
  testVerdictThinNeverDominates,
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
  // agent is writing mid-test (nondeterministic — a live agent writes to them).
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
  testAnalyzeExportsThroughBarrels();
  testAnalyzeIsTestFile();
  testAnalyzeBarrelHidesTests();
  testAnalyzeSkipsNestedCheckouts();
  testGraphCacheInProcessInvalidation();
  testGraphCacheWriteThroughInvalidateFallback();
  testMapExtractExports();
  testMapExtractExportsParseError();
  testMapExtractIgnoresSampleText();
  testMapExtractMultilineTypeBlock();
  testMapExtractVarDeclaratorLists();
  testPlanSeedWritesPlan();
  testPlanSeedNoOverwrite();
  testPlanSeedStepCloseCarriesLiteralPlanPath();
  testPlanSeedSpecSignatures();
  testPlanSeedScopeFilters();
  testPlanSeedCapsHold();
  testPlanSeedSingleFileScope();
  testPlanSeedOverlapScopeDedup();
  testPlanSeedConfigFallback();
  testReviewSeedScopeFlags();
  testReviewSeedStructure();
  testReviewSeedRenames();
  testReviewSeedDeterministicAndNoWrite();
  testReviewSeedBarrelAndScopeList();
  testReviewSeedBodyAndCallers();
  testReviewSeedFilesLookupUncapped();
  testReviewSeedFilesDirExpansion();
  testReviewSeedPlanCrossCheck();
  testReviewSeedNotARepo();
  testReviewSeedStateDbUntouched();
  testDecideStopBlocksUngradedCommits();
  testDecideStopDerivesCommandFromWorktree();
  testDecideStopReportsCommitsAndMem();
  testDecideStopMemBlocksWhenStale();
  testDecideStopComparesProductionTimestampShapes();
  testDecideStopMessageIsRepoNeutral();
  testDecideStopNamesOutOfScopeMemLog();
  testStopBlocksOncePerSessionPerWorktree();
  testSessionStartContextIsCapped();
  testHookSessionStartSilentWithoutMemLog();
  testSessionStartPluginSource();
  testStopHookSourceHasNoRepoSpecificCommands();
  testReadHintAnnotatesLargeFullRead();
  testReadHintSkipsCheapReads();
  testReadHintNeedsGitRepo();
  testReadHintClaudeOutputShape();
  testReadHintPluginSource();
  testRereadHintFiresOnUnchangedRepeat();
  testRereadHintSilentAfterEdit();
  testRereadHintKillSwitch();
  testEditHintFiresWithImporters();
  testEditHintSilentZeroImporters();
  testEditHintSkipsNonSourceAndMissing();
  testEditHintNeedsGitRepo();
  testEditHintDedupesPerSessionPerFile();
  testEditHintFiresWithoutSession();
  testEditHintClaudeOutputShape();
  testEditHintPluginSource();
  testCommitHintMinCommitsConstant();
  testCommitHintNullForNonCommit();
  testCommitHintNullOutsideGitRepo();
  testCommitHintFiresForCommitsSinceMemRow();
  testCommitHintSilentWithoutMemLog();
  testCommitHintSilentWhenMemRowCoversCommits();
  testCommitHintPluginSource();
  testReadContextShowsDebtBeforeFix();
  testReadContextMemRowsByFilesAndPath();
  testReadContextBasenameAmbiguityStaysSilent();
  testReadContextCombinedCapAndOutsideRepo();
  testDecideStopAllowsEveryUnknown();
  testStopPayloadsMapToSameDecision();
  testCursorPayloadEdges();
  testStopOutputShapesPerClient();
  testCodexPayloadDetection();
  testCodexNormalizeMapsToSameDecision();
  testCodexStopHookActiveAllows();
  testCodexStopOutputShape();
  testUtcStampMatchesSqliteFormat();
  testComputeHintImpact();
  testComputeHintImpactNoLog();
  testDbLifecycle();
  testSchemaVersionStamped();
  testLegacyDbStampedWithoutDataLoss();
  testMigrateDbRejectsNewerSchema();
  testDebtSilentWithoutConventions();
  testSeedEslintEntriesCarryChecker();
  await testSeedEslintSupersetBlocksDedupe();
  await testSeedWrapperDetectorFindsLiveMigrations();
  await testSeedRepoWithoutAnythingGetsEmptyFile();
  await testSeedNeverOverwritesExisting();
  await testSeedBrokenConfigIsSkippedLoudly();
  testDebtDerivesListAndDropsWithTheFile();
  testDebtCheckerRowsStaySilent();
  testDebtTooBroadRegexDropped();
  testDebtForFileAndMonorepoResolution();
  testDebtWorktreeFollowsThePathNotGitRoot();
  testDetectBunViaPackageManager();
  testDetectBunViaPackageManagerWithTypecheckScript();
  testDetectNpmViaLockfile();
  testDetectPnpmViaLockfile();
  testDetectYarnViaLockfile();
  testDetectNullWhenNoPackageJson();
  testDetectNullWhenPackageJsonHasNoSignal();
  testDetectSkipsUnrecognizedPackageManager();
  testDebtPromotionAsksAtThresholdOnly();
  testDebtPromotionCountsLedgerFails();
  testDebtConventionsPathResolution();
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
  testMemoryDefaultWiringWithDir();
  testMemoryDefaultWiringNoDir();
  testMemoryExplicitConfigWins();
  testMemAddWritesWhereMemFindReads();
  testMemAddRejectsMissingFilesAndBadKind();
  testMemCloseWritesTombstoneForExistingId();
  testMemCloseRejectsUnknownIdAndEmptyText();
  testMemIdentityNeverCollapsesToUnknown();
  testMemFindReturnsAllKindsNoDefaultFilter();
  testMemFindFiltersAndMatchesFiles();
  testMemFindMatchesStoredFiles();
  testMemFindTotalVsLimitAndFailShapes();
  testMemFindToolValidation();
  testClaimMemoryFailGracefully();
  testMemoryReadRecentDecisions();
  testMemoryReadRecentDecisionsMonorepo();
  testReadMemLogIncludesRotatedArchives();
  testMemDirWalkStopsAtRepoRoot();
  testMemDirSkipsEmptyCandidate();
  testMemDirConfigIsRepoRootRelative();
  testMemDirOverrideWinsAndRefusesMissing();
  testMemDirAmbiguousRefusesWrite();
  testMemDirSingleOutOfScopeReportsCandidate();
  // Digest tests
  await testDigestEmptyRepo();
  await testDigestSinceFilter();
  await testDigestEscInjection();
  await testDigestMalformedLine();
  await testDigestJsonSubsetOfText();
  await testDigestInvalidSince();
  await testDigestPlanProgress();
  await testDigestImpactSection();
  await testDigestImpactNoLog();
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
  testComputeModelFit();
  testContextBlockMemDecisions();
  testContextBlockModelFitLine();
  testContextBlockMergesReasonsAcrossWorktrees();
  testContextBlockNoteCapAndNoneTag();
  testContextBlockHubLine();
  testContextBlockHubLowHistory();
  testContextBlockHubSilentBelowThreshold();
  testContextBlockHubCapHolds();
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
  testInstallClaudeAlreadyConfiguredStillInstallsHooks();
  testInstallClaudeDifferentCommandRefusesOverwrite();
  testInstallClaudeStopHookAppendsOnceAndKeepsForeign();
  testInstallClaudeReadHintAppendsOnce();
  testInstallClaudeEditHintAppendsOnce();
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
  testInstallOpencodeMcpCommandIsAbsolute();
  testInstallOpencodeReadHintPlugin();
  testInstallOpencodeReadHintForeignFileUntouched();
  testInstallOpencodeCommitHintPlugin();
  testInstallOpencodeCommitHintIdempotent();
  testInstallOpencodeCommitHintForeignFileUntouched();
  testInstallOpencodeCommitHintDryRun();
  testInstallOpencodeEditHintPlugin();
  testInstallOpencodeEditHintForeignFileUntouched();
  testInstallOpencodeEditHintDryRun();
  testInstallOpencodeSessionStartPlugin();
  testInstallOpencodeSessionStartStaleWarns();
  testInstallOpencodeSessionStartForeignFileUntouched();
  testInstallOpencodeSessionStartDryRun();
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
  testInstallCodexCreatesHooksJson();
  testInstallCodexHooksMergePreservesForeign();
  testInstallCodexHooksAlreadyConfiguredNoOp();
  testInstallCodexSessionStartUpgradeAppends();
  testInstallCodexHooksMalformedSkipsGracefully();
  testInstallCodexDryRunHooksNoWrite();
  testInstallCodexLinksSkills();
  testInstallCodexSkillsConflictUntouched();
  testInstallCodexFindHooksJson();
  testInstallCursorNoDirFails();
  testInstallCursorFreshWritesMcpAndHooks();
  testInstallCursorMergesStopHookKeepsOthers();
  testInstallCursorForeignMcpRefuses();
  testInstallCursorAlreadyConfiguredNoOp();
  testInstallCursorDryRunNoWrite();
  testCmdInstallDispatchesCursor();
  testInstallAntigravityNoDirFails();
  testInstallAntigravityFreshWritesMcpAndSkills();
  testInstallAntigravityForeignMcpRefuses();
  testInstallAntigravityAlreadyConfiguredNoOp();
  testInstallAntigravityDryRunNoWrite();
  testInstallAntigravityMergesExistingServers();
  testCmdInstallDispatchesAntigravity();
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
  testReasonCodesListedInDocs();
  testRegimeCodesListedInDocs();
  testLintBaselineCaptureAndCleanDiff();
  testLintBaselineDiffReportsOnlyNewFindings();
  testLintBaselineUnixFormatAndErrors();
  testAddingFakeEnumValueFailsDocsCheck();
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
  testStatsRegimeTokensSplitNotDuplicated();
  testStatsTokensInByModel();
  testStatsTokensCountSessionOnce();
  testStatsTokensPerPassChargesReworkOnce();
  testStatsTokensPerPassNullWhenNoPass();
  testStatsTokensPerPassNullWithoutTokens();
  testVerdictDominatedRowNamesDominator();
  testVerdictSingleModelShowsDash();
  testVerdictThinNeverDominates();
  testVerdictNoRegimeShowsOneLinerPerRegime();
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
  testReportWebRefusesWhenCommittable();
  testReportWebForceOverrides();
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
