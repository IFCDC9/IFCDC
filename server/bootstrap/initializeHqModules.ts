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
import { ensureMissionControlTables } from "../hq/missionControlSchema";
import { initGoogleOAuth } from "../monolith/googleOAuth";
import { initLegacyMonolithDb, type FounderSeedConfig } from "../monolith/legacyDbBootstrap";

/** Initialize legacy SQLite schema, seeds, and all HQ module tables. */
export async function initializeHqModules(founder: FounderSeedConfig): Promise<void> {
  await initLegacyMonolithDb(founder);
  await ensureGrantModulesReady();
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
