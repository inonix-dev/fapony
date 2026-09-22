// test/index.ts — test runner. Import all test modules and run sequentially.

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
  // Usage-web tests
  testResolveWorktreeArgAbsolutePath();
  testResolveWorktreeArgKeyLookup();
  testResolveWorktreeArgKeyNotFound();
  testResolveWorktreeArgSentinel();
  console.log("\nall tests passed ✓");
}
