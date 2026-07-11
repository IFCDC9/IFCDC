import { ensureGrantModulesReady } from "../hq/grantModuleBootstrap";
import { ensurePeopleTables } from "../hq/peopleSchema";
import { ensureOperationsTables } from "../hq/operationsSchema";
import { ensureDashboardTables } from "../hq/dashboardSchema";
import { ensureSoftwareDivisionTables } from "../hq/softwareDivisionSchema";
import { ensureDeveloperAuditTables } from "../hq/hqDeveloperAudit";
import { ensureExecutiveBriefingsTable, getOrGenerateDailyBriefing } from "../hq/executiveBriefings";
import { ensureBoardPortalTables } from "../hq/boardPortalSchema";
import { ensureHqAuditTables } from "../hq/hqAuditLog";
import { ensureWarehouseTables } from "../hq/analyticsWarehouseSchema";
import { ensureWorkflowTables } from "../hq/workflowEngineSchema";
import { ensureBackupTables } from "../hq/hqBackupService";
import { ensureSecuritySessionTables } from "../hq/hqSecuritySessions";
import { ensureProgramModuleTables } from "../hq/programsSchema";
import { ensureEnterpriseReadinessSeed } from "../hq/enterpriseReadinessSeed";
import { ensureNotificationQueueTables } from "../hq/notificationQueue";
import { ensureCommunicationsTables } from "../hq/communicationsSchema";
import { ensureDocumentTables } from "../hq/documentsSchema";
import { ensureHqFileRegistry } from "../hq/hqFileStorage";
import { syncGrantFeeds } from "../hq/grantFeedConnectors";
import { purgeGrantDevSeedData } from "../hq/grantProductionCleanup";
import { purgeHqSampleData } from "../hq/hqProductionCleanup";
import { purgeWorkflowDemoData } from "../hq/workflowProductionCleanup";
import { ensureGrantWriterTables } from "../hq/grantWriterEngine";
import { ensureAuraMemoryTables } from "../hq/auraMemory";
import { ensureKnowledgeBaseTables } from "../hq/knowledgeBaseEngine";
import { ensureAuraTrustTables } from "../hq/auraFounderTrustEngine";
import { ensureTechCommandTables } from "../hq/auraTechnicalCommandEngine";
import { ensureProactiveIntelligenceTables } from "../hq/auraProactiveIntelligence";
import { ensureEnterpriseBrainTables } from "../hq/auraEnterpriseBrain";
import { logOpenAiConfigAtBoot } from "../lib/openaiConfig";
import { ensureMissionControlTables } from "../hq/missionControlSchema";
import { initGoogleOAuth } from "../monolith/googleOAuth";
import { initLegacyMonolithDb, type FounderSeedConfig } from "../monolith/legacyDbBootstrap";

/** Initialize legacy SQLite schema, seeds, and all HQ module tables. */
export async function initializeHqModules(founder: FounderSeedConfig): Promise<void> {
  await initLegacyMonolithDb(founder);
  await ensureGrantModulesReady();
  await ensureGrantWriterTables();
  logOpenAiConfigAtBoot();
  await purgeGrantDevSeedData().catch((e) => console.warn("Grant dev_seed purge skipped:", e?.message));
  await purgeHqSampleData().catch((e) => console.warn("HQ sample data purge skipped:", e?.message));
  await purgeWorkflowDemoData().catch((e) => console.warn("Workflow demo purge skipped:", e?.message));
  await ensurePeopleTables();
  await ensureOperationsTables();
  await ensureMissionControlTables();
  await ensureDashboardTables();
  await ensureSoftwareDivisionTables();
  await ensureDeveloperAuditTables();
  await ensureExecutiveBriefingsTable();
  await ensureBoardPortalTables();
  await ensureHqAuditTables();
  await ensureWarehouseTables();
  await ensureWorkflowTables();
  await ensureProgramModuleTables();
  await ensureEnterpriseReadinessSeed();
  await ensureNotificationQueueTables();
  await ensureCommunicationsTables();
  await ensureDocumentTables();
  await ensureHqFileRegistry();
  await ensureBackupTables();
  await ensureSecuritySessionTables();
  await ensureAuraMemoryTables();
  await ensureKnowledgeBaseTables();
  await ensureAuraTrustTables();
  await ensureTechCommandTables();
  await ensureProactiveIntelligenceTables();
  await ensureEnterpriseBrainTables();
  const { ensureExecutiveDecisionIntelligenceTables } = await import("../hq/auraExecutiveDecisionIntelligence");
  await ensureExecutiveDecisionIntelligenceTables();
  // Build AURA's institutional knowledge base from live HQ data. Deferred so
  // dashboard reads are not blocked at boot; embedding controlled by env flag.
  setTimeout(() => {
    import("../hq/knowledgeBaseEngine")
      .then(({ syncKnowledgeBaseFromHq }) =>
        syncKnowledgeBaseFromHq({ embed: process.env.AURA_KB_AUTOEMBED !== "false" })
      )
      .then((r) => {
        if (r) console.log(`AURA knowledge base sync: ingested ${r.ingested}, skipped ${r.skipped}`);
      })
      .catch((e) => console.warn("Knowledge base boot sync skipped:", e?.message));
  }, 90_000);
  // Proactive intelligence — meaningful Founder alerts only (deduped). Deferred.
  setTimeout(() => {
    import("../hq/auraProactiveIntelligence")
      .then(({ evaluateAndEmitProactiveAlerts }) =>
        evaluateAndEmitProactiveAlerts({ notifyFounderChannels: false })
      )
      .then((r) => {
        if (r) console.log(`AURA proactive scan: evaluated=${r.evaluated} emitted=${r.emitted}`);
      })
      .catch((e) => console.warn("AURA proactive scan skipped:", e?.message));
  }, 120_000);
  getOrGenerateDailyBriefing().catch((e) => console.warn("Morning briefing generation skipped:", e?.message));
  await initGoogleOAuth();
  import("../hq/warehouseScheduler").then(({ startHqScheduler }) => startHqScheduler()).catch(() => undefined);
  syncGrantFeeds().then((results) => {
    const connected = results.filter((r) => r.status === "connected").length;
    console.log(`Grant feed sync complete: ${connected}/${results.length} feeds connected`);
  }).catch((e) => console.warn("Grant feed sync skipped:", e?.message));
  import("../hq/grantIntelligenceEngine")
    .then(({ scheduleGrantIntelligenceSync, runGrantIntelligenceSync, enrichAllOpportunities }) => {
      scheduleGrantIntelligenceSync();
      return runGrantIntelligenceSync().then((r) => enrichAllOpportunities(100).then((enriched) => ({ ...r, enriched })));
    })
    .then((r) => {
      if (r) console.log(`Grant Intelligence Engine boot sync: enriched ${r.enriched} opportunities`);
    })
    .catch((e) => console.warn("Grant intelligence boot sync skipped:", e?.message));
  import("../hq/grantFundingPipelineEngine")
    .then(({ scheduleLivePipelineSync, runLivePipelineSync }) => {
      scheduleLivePipelineSync();
      // Defer heavy feed+stage sync so dashboard reads are not blocked at boot.
      setTimeout(() => {
        void runLivePipelineSync()
          .then((r) => {
            if (r) console.log(`Enterprise Funding Pipeline boot sync: ${r.stagesSynced} stages, ${r.notifications} notifications`);
          })
          .catch((e) => console.warn("Funding pipeline boot sync skipped:", e?.message));
      }, 120_000);
    })
    .catch((e) => console.warn("Funding pipeline scheduler skipped:", e?.message));
  if (process.env.NODE_ENV === "production") {
    import("../hq/twilioIntegrationEngine")
      .then(({ syncTwilioWebhooksIfNeeded }) => syncTwilioWebhooksIfNeeded())
      .then((result) => {
        if (result?.synced) console.log(`Twilio startup webhook sync: ${result.message}`);
      })
      .catch((e) => console.warn("Twilio webhook sync skipped:", e?.message));
    import("../hq/auraReceptionistSession")
      .then(({ ensureReceptionistSessionTable }) => ensureReceptionistSessionTable())
      .catch((e) => console.warn("AURA receptionist session table skipped:", e?.message));
  }
  console.log("IFCDC HQ database and modules initialized");
}
