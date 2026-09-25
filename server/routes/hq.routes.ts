import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { SOFTWARE_DIVISION_APPS, pollAllApps, getSoftwareDivisionApps } from "../hq/appRegistry";
import { buildSoftwareDivisionHealthScore } from "../hq/enterpriseHealthScoring";
import { toHQRole, HQ_MODULE_PERMISSIONS } from "../hq/enterpriseRoles";
import peopleRouter from "./people.routes";
import clientsHqRouter from "./clients-hq.routes";
import enterpriseAuthRouter from "./enterpriseAuth.routes";
import { checkIfcdcServices, auraExecutiveChat, getAuraProductionCoreStatus } from "../lib/ifcdc";
import { sendHqNotification, getEmailDeliveryStatus, resolveResendFromEmail } from "../lib/notifications";
import { getOrganizationMetrics, getRecentActivity, getMonthlyTrend } from "../hq/metrics";
import grantsRouter from "./grants.routes";
import financeRouter from "./finance.routes";
import analyticsRouter from "./analytics.routes";
import enterpriseRouter from "./enterprise.routes";
import operationsRouter from "./operations.routes";
import workspaceRouter from "./workspace.routes";
import developerRouter from "./developer.routes";
import communicationsRouter from "./communications.routes";
import documentsRouter from "./documents.routes";
import policyRouter from "./policy.routes";
import learningRouter from "./learning.routes";
import programsHqRouter from "./programs-hq.routes";
import boardRouter from "./board.routes";
import reportingRouter from "./reporting.routes";
import filesRouter from "./files.routes";
import warehouseRouter from "./warehouse.routes";
import workflowRouter from "./workflow.routes";
import integrationsRouter from "./integrations.routes";
import securityRouter from "./security.routes";
import monitoringRouter from "./monitoring.routes";
import intelligenceRouter from "./intelligence.routes";
import phase9Router from "./phase9.routes";
import phase10Router from "./phase10.routes";
import softwareEngineeringRouter from "./softwareEngineering.routes";
import enterpriseOps5Router from "./enterpriseOps5.routes";
import enterpriseReadinessRouter from "./enterpriseReadiness.routes";
import enterpriseHealthRouter from "./enterpriseHealth.routes";
import autonomousOpsRouter from "./auraAutonomousOps.routes";
import auraMusicNodeRouter from "./auraMusicNode.routes";
import auraOpsVerifyRouter from "./auraOpsVerify.routes";
import {
  detectOperationalAnomalies,
  predictFinancialRisk,
  trackComplianceDeadlines,
  generateAuraExecutiveSummary,
} from "../hq/auraExecutiveOps";
import { hqMutationPushMiddleware } from "../hq/hqRealtimeEvents";
import { buildOrganizationHealthScore, buildHeadquartersActivityFeed } from "../hq/analyticsReporting";
import { buildAuraExecutiveContext } from "../hq/auraExecutiveContext";
import { searchHqModules, buildDepartmentMonitoringSummary } from "../hq/auraModuleSearch";
import { buildSoftwareDivisionFramework } from "../hq/softwareDivisionFramework";
import { hqApiLimiter, hqSecurityHeaders } from "../middleware/hqSecurity";
import { buildPredictiveTrends } from "../hq/analyticsReporting";
import { runAppDiagnostics, runAllAppDiagnostics } from "../hq/appDiagnostics";
import { listRegisteredApps, registerSoftwareApp, updateSoftwareApp, deleteSoftwareApp } from "../hq/softwareDivisionSchema";
import { createPackageCache } from "../hq/packageCache";
import { logDeveloperAudit } from "../hq/hqDeveloperAudit";
import { notifyHqDataChange } from "../hq/hqRealtimeEvents";
import {
  answerEnterpriseQuestion,
  generateEnterpriseBoardReport,
  getAuraModuleInsights,
} from "../hq/auraEnterpriseIntelligence";
import {
  askOperationsCopilot,
  getOperationsCopilotBriefing,
} from "../hq/auraOperationsCopilot";
import {
  buildExecutiveHealthSummary,
  generateExecutiveActionPlan,
} from "../hq/auraExecutiveAssistant";
import { ensureGrantTables } from "../hq/grantsSchema";
import { getDb } from "../db";

const router = Router();

router.use(hqSecurityHeaders);
router.use(hqApiLimiter);
router.use(hqMutationPushMiddleware);

router.use("/auth", enterpriseAuthRouter);
router.use("/people", peopleRouter);
router.use("/clients", clientsHqRouter);
router.use("/grants", grantsRouter);
router.use("/finance", financeRouter);
router.use("/analytics", analyticsRouter);
router.use("/enterprise", enterpriseRouter);
router.use("/operations", operationsRouter);
router.use("/workspace", workspaceRouter);
router.use("/developer", developerRouter);
router.use("/communications", communicationsRouter);
router.use("/documents", documentsRouter);
router.use("/policies", policyRouter);
router.use("/learning", learningRouter);
router.use("/programs", programsHqRouter);
router.use("/files", filesRouter);
router.use("/board-portal", boardRouter);
router.use("/reporting", reportingRouter);
router.use("/warehouse", warehouseRouter);
router.use("/workflows", workflowRouter);
router.use("/integrations", integrationsRouter);
router.use("/security", securityRouter);
router.use("/monitoring", monitoringRouter);
router.use("/intelligence", intelligenceRouter);
router.use("/phase9", phase9Router);
router.use("/phase10", phase10Router);
router.use("/aura/software-engineering", softwareEngineeringRouter);
router.use("/aura/os5", enterpriseOps5Router);
router.use("/enterprise-readiness", enterpriseReadinessRouter);
router.use("/enterprise-health", enterpriseHealthRouter);
router.use("/aura/autonomous", autonomousOpsRouter);
router.use("/aura/ops", auraOpsVerifyRouter);
router.use("/aura/music", auraMusicNodeRouter);

router.get("/health", (_req: Request, res: Response) => {
  // Presence flags only — never echo secret values.
  let runwayPresent: "PRESENT" | "NOT_PRESENT" = "NOT_PRESENT";
  try {
    // Dynamic import avoided; sync presence check via env shape only.
    const raw = String(process.env.RUNWAY_API_KEY || "").trim();
    runwayPresent =
      Boolean(raw) && raw.length >= 8 && !/placeholder|your[_-]?|xxx|replace/i.test(raw)
        ? "PRESENT"
        : "NOT_PRESENT";
  } catch {
    runwayPresent = "NOT_PRESENT";
  }
  res.json({
    app: "ifcdc-headquarters",
    status: "healthy",
    version: "1.0.0",
    platform: "IFCDC Enterprise Operating System",
    phase: "6C",
    RUNWAY_API_KEY_PRESENT: runwayPresent,
  });
});

/** Non-secret email delivery readiness (Founder OTP depends on this). */
router.get("/email/status", async (req: Request, res: Response) => {
  const status = getEmailDeliveryStatus();
  const { probeResendSender, sendFounderSecurityEmail } = await import("../lib/notifications");
  const { getSenderAuthStatus, emailEngineCatalog } = await import("../hq/emailEngine");
  const { getResendDomainSetupState, restoreEmergencyResendSender } = await import("../hq/resendDomainEngine");

  // Only restore emergency sender when configured domain is not verified.
  // Always-on restore caused rate limits and false fallback reporting after ifcdc.org verified.
  let emergencyRestore: Awaited<ReturnType<typeof restoreEmergencyResendSender>> | {
    ok: boolean;
    domain: string;
    verified: boolean;
    created: boolean;
    records: unknown[];
    skipped?: boolean;
    error?: string;
  } = { ok: true, domain: "ifcdcbarbersapp.com", verified: false, created: false, records: [], skipped: true };
  const probeQuick = await probeResendSender().catch(() => null);
  // probe.ok means the configured RESEND_FROM_EMAIL domain itself is verified.
  const configuredDomainOk = Boolean(probeQuick?.ok);
  if (!configuredDomainOk) {
    emergencyRestore = await restoreEmergencyResendSender().catch((err) => ({
      ok: false,
      domain: "ifcdcbarbersapp.com",
      verified: false,
      created: false,
      records: [] as unknown[],
      error: err instanceof Error ? err.message : "emergency restore failed",
    }));
  }

  const [resendProbe, senderAuth, domainSetup] = await Promise.all([
    probeResendSender().catch((err) => ({
      ok: false,
      apiKeySet: status.apiKeySet,
      from: status.from || "",
      error: err instanceof Error ? err.message : "probe failed",
    })),
    getSenderAuthStatus().catch((err) => ({
      configured: status.apiKeySet,
      from: status.from || "",
      fromDomain: null,
      domainVerified: false,
      usedFallback: false,
      spf: { status: "unknown" },
      dkim: { status: "unknown" },
      dmarc: { status: "unknown" },
      records: [],
      domains: [],
      trustedSender: false,
      guidance: [],
      error: err instanceof Error ? err.message : "auth status failed",
    })),
    getResendDomainSetupState().catch((err) => ({
      error: err instanceof Error ? err.message : "domain setup failed",
    })),
  ]);

  let liveTest: Record<string, unknown> | null = null;
  if (String(req.query.liveTest || "") === "1") {
    const to = String(req.query.to || "service@ifcdc.org").trim().toLowerCase();
    const allowed = to === "service@ifcdc.org" || to === (process.env.MASTER_OWNER_EMAIL || "").toLowerCase();
    if (!allowed) {
      liveTest = { success: false, error: "liveTest only allowed to service@ifcdc.org / MASTER_OWNER_EMAIL" };
    } else {
      const { resolveVerifiedResendFromEmail } = await import("../lib/notifications");
      const verified = await resolveVerifiedResendFromEmail();
      const send = await sendFounderSecurityEmail({
        to,
        subject: "IFCDC HQ — live email delivery test",
        body:
          "This is a live production delivery test from IFCDC Headquarters.\n\n"
          + "If you received this message, Resend accepted the send and mailbox delivery succeeded.\n"
          + `From: ${verified.from}\n`
          + `Time: ${new Date().toISOString()}\n`,
      });
      liveTest = {
        success: send.success,
        messageId: send.messageId || null,
        error: send.error || null,
        providerCode: send.providerCode || null,
        providerStatus: send.providerStatus || null,
        from: verified.from,
        usedFallback: verified.usedFallback,
        to,
        at: new Date().toISOString(),
      };
      console.info(
        `[email] liveTest → to=${to} success=${send.success} messageId=${send.messageId || "none"} error=${send.error || "none"}`,
      );
    }
  }

  const compact = String(req.query.compact || "") === "1" || String(req.query.summary || "") === "1";
  const payload = {
    configured: status.configured,
    provider: status.provider,
    from: status.from,
    apiKeySet: status.apiKeySet,
    notificationsUrl: status.notificationsUrl,
    inlineOnly: status.inlineOnly,
    fromPreview: status.apiKeySet ? resolveResendFromEmail() : null,
    founderOtpTo: process.env.MASTER_OWNER_EMAIL || process.env.FOUNDER_EMAIL || "service@ifcdc.org",
    purpose: "AURA Founder verification OTP + Communications Center + branded HQ email engine",
    resendProbe: compact
      ? {
          ok: (resendProbe as { ok?: boolean }).ok,
          error: (resendProbe as { error?: string }).error,
          domains: (resendProbe as { domains?: unknown }).domains,
        }
      : resendProbe,
    senderAuth: compact
      ? {
          from: (senderAuth as { from?: string }).from,
          usedFallback: (senderAuth as { usedFallback?: boolean }).usedFallback,
          domainVerified: (senderAuth as { domainVerified?: boolean }).domainVerified,
          trustedSender: (senderAuth as { trustedSender?: boolean }).trustedSender,
          guidance: ((senderAuth as { guidance?: string[] }).guidance || []).slice(0, 3),
        }
      : senderAuth,
    emergencyRestore: compact
      ? {
          ok: (emergencyRestore as { ok?: boolean }).ok,
          domain: (emergencyRestore as { domain?: string }).domain,
          verified: (emergencyRestore as { verified?: boolean }).verified,
          status: (emergencyRestore as { status?: string }).status,
          error: (emergencyRestore as { error?: string }).error,
        }
      : emergencyRestore,
    domainSetup: compact
      ? {
          targetDomain: (domainSetup as { targetDomain?: string }).targetDomain,
          registered: (domainSetup as { registered?: boolean }).registered,
          verified: (domainSetup as { verified?: boolean }).verified,
          usedFallback: (domainSetup as { usedFallback?: boolean }).usedFallback,
          fromEffective: (domainSetup as { fromEffective?: string }).fromEffective,
          error: (domainSetup as { error?: string }).error,
        }
      : domainSetup,
    liveTest,
    engine: compact ? undefined : emailEngineCatalog(),
    ok: true,
  };

  // Browsers navigating directly often look "blank" on raw JSON — serve a readable HTML summary.
  const accept = String(req.headers.accept || "");
  if (accept.includes("text/html") && String(req.query.json || "") !== "1") {
    const lt = liveTest as { success?: boolean; messageId?: string; error?: string } | null;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>IFCDC Email Status</title>
<style>body{font-family:ui-monospace,Menlo,monospace;background:#0a0a0a;color:#f7f4ec;padding:1.5rem;line-height:1.5}
a{color:#c9a227} .ok{color:#6bcf7f} .bad{color:#f07178} pre{white-space:pre-wrap;background:#111;padding:1rem;border:1px solid #333}</style></head><body>
<h1>IFCDC HQ Email Status</h1>
<p>API key: <b class="${payload.apiKeySet ? "ok" : "bad"}">${payload.apiKeySet ? "SET" : "MISSING"}</b></p>
<p>Configured From: ${payload.fromPreview || "—"}</p>
<p>Effective From: ${(payload.senderAuth as { from?: string })?.from || "—"}</p>
<p>Emergency restore: <b class="${(payload.emergencyRestore as { verified?: boolean })?.verified ? "ok" : "bad"}">${JSON.stringify(payload.emergencyRestore)}</b></p>
<p>Probe: ${JSON.stringify(payload.resendProbe)}</p>
${lt ? `<p>Live test: <b class="${lt.success ? "ok" : "bad"}">${lt.success ? "ACCEPTED" : "FAILED"}</b> messageId=${lt.messageId || "none"} error=${lt.error || "none"}</p>` : `<p>Add <code>?liveTest=1</code> to send a test to service@ifcdc.org</p>`}
<p><a href="?json=1&compact=1">View compact JSON</a> · <a href="?liveTest=1">Run liveTest</a></p>
<pre>${JSON.stringify(payload, null, 2).replace(/</g, "&lt;")}</pre>
</body></html>`);
  }

  res.json(payload);
});

router.post("/email/domain/ensure", hqAuthRequired, async (req: Request, res: Response) => {
  const email = (req.hqUser?.email || "").toLowerCase();
  if (!req.hqUser || (req.hqUser.role !== "owner" && email !== "service@ifcdc.org")) {
    return res.status(403).json({ error: "Founder Mode required" });
  }
  const { ensureResendDomainRegistered, getResendDomainSetupState, getTargetSenderDomain } = await import("../hq/resendDomainEngine");
  const domain = String(req.body?.domain || getTargetSenderDomain()).toLowerCase();
  const ensured = await ensureResendDomainRegistered(domain);
  const setup = await getResendDomainSetupState(domain);
  res.json({ ok: !ensured.error, ensured, setup });
});

/** Replace plan-slot domain (e.g. ifcdcbarbersapp.com) with ifcdc.org. Founder only. */
router.post("/email/domain/replace", hqAuthRequired, async (req: Request, res: Response) => {
  const email = (req.hqUser?.email || "").toLowerCase();
  if (!req.hqUser || (req.hqUser.role !== "owner" && email !== "service@ifcdc.org")) {
    return res.status(403).json({ error: "Founder Mode required" });
  }
  const {
    replaceResendDomainWithTarget,
    getResendDomainSetupState,
    getTargetSenderDomain,
  } = await import("../hq/resendDomainEngine");
  const domain = String(req.body?.domain || getTargetSenderDomain()).toLowerCase();
  const result = await replaceResendDomainWithTarget(domain);
  const setup = await getResendDomainSetupState(domain);
  res.status(result.ok ? 200 : 409).json({ ...result, setup });
});

/** Emergency restore: re-register ifcdcbarbersapp.com and verify so mail can send. */
router.post("/email/domain/restore-emergency", hqAuthRequired, async (req: Request, res: Response) => {
  const email = (req.hqUser?.email || "").toLowerCase();
  if (!req.hqUser || (req.hqUser.role !== "owner" && email !== "service@ifcdc.org")) {
    return res.status(403).json({ error: "Founder Mode required" });
  }
  const { restoreEmergencyResendSender, getResendDomainSetupState } = await import("../hq/resendDomainEngine");
  const restored = await restoreEmergencyResendSender();
  const setup = await getResendDomainSetupState();
  res.status(restored.verified || restored.ok ? 200 : 409).json({ restored, setup });
});

router.post("/email/domain/verify", hqAuthRequired, async (req: Request, res: Response) => {
  const email = (req.hqUser?.email || "").toLowerCase();
  if (!req.hqUser || (req.hqUser.role !== "owner" && email !== "service@ifcdc.org")) {
    return res.status(403).json({ error: "Founder Mode required" });
  }
  const { verifyResendDomain, getResendDomainSetupState, getTargetSenderDomain } = await import("../hq/resendDomainEngine");
  const domain = String(req.body?.domain || getTargetSenderDomain()).toLowerCase();
  const result = await verifyResendDomain(domain);
  const setup = await getResendDomainSetupState(domain);
  res.status(result.ok ? 200 : 409).json({ ...result, setup });
});

router.post("/email/live-send", async (req: Request, res: Response) => {
  const { sendFounderSecurityEmail, resolveVerifiedResendFromEmail } = await import("../lib/notifications");
  const to = String(req.body?.to || "service@ifcdc.org").trim().toLowerCase();
  const allowed =
    to === "service@ifcdc.org"
    || to === (process.env.MASTER_OWNER_EMAIL || "").toLowerCase()
    || to === (process.env.FOUNDER_EMAIL || "").toLowerCase();
  if (!allowed) {
    return res.status(403).json({
      success: false,
      error: "live-send only allowed to service@ifcdc.org / MASTER_OWNER_EMAIL / FOUNDER_EMAIL",
    });
  }
  const subject = String(req.body?.subject || "AURA Production Email Test — IFCDC HQ").trim().slice(0, 200);
  const body = String(req.body?.body || req.body?.message || "").trim().slice(0, 12_000);
  if (!body) {
    return res.status(400).json({ success: false, error: "body/message is required" });
  }

  const verified = await resolveVerifiedResendFromEmail();
  const send = await sendFounderSecurityEmail({ to, subject, body });
  const payload = {
    success: send.success,
    messageId: send.messageId || null,
    error: send.error || null,
    providerCode: send.providerCode || null,
    providerStatus: send.providerStatus || null,
    from: verified.from,
    usedFallback: verified.usedFallback,
    to,
    subject,
    at: new Date().toISOString(),
  };
  console.info(
    `[email] live-send → to=${to} from=${verified.from} success=${send.success} messageId=${send.messageId || "none"}`,
  );
  return res.status(send.success ? 200 : 502).json(payload);
});

/** Read-only Executive Email Readiness Report (inventory + dry-render + last matrix results). */
router.get("/email/readiness", async (_req: Request, res: Response) => {
  const { buildEmailReadinessReport } = await import("../hq/emailReadinessEngine");
  const report = await buildEmailReadinessReport();
  res.json({ ok: true, report });
});

/**
 * Founder-inbox template matrix (real Resend). Same recipient allowlist as live-send.
 * Does not bulk-broadcast. Sends one branded email per catalog template.
 */
router.post("/email/readiness/run-matrix", async (req: Request, res: Response) => {
  const to = String(req.body?.to || "service@ifcdc.org").trim().toLowerCase();
  const { runFounderInboxTemplateMatrix, buildEmailReadinessReport } = await import("../hq/emailReadinessEngine");
  try {
    const lastResults = await runFounderInboxTemplateMatrix(to);
    const report = await buildEmailReadinessReport({ lastResults });
    res.json({
      ok: true,
      matrix: {
        to,
        sent: lastResults.filter((r) => r.result === "PASS").length,
        failed: lastResults.filter((r) => r.result === "FAIL").length,
        notConfigured: lastResults.filter((r) => r.result === "NOT_CONFIGURED").length,
      },
      lastResults,
      report,
    });
  } catch (err) {
    res.status(403).json({
      ok: false,
      error: err instanceof Error ? err.message : "matrix failed",
    });
  }
});

router.get("/email/templates", hqAuthRequired, async (_req: Request, res: Response) => {
  const { emailEngineCatalog } = await import("../hq/emailEngine");
  res.json(emailEngineCatalog());
});

router.post("/email/send-template", hqAuthRequired, async (req: Request, res: Response) => {
  const email = (req.hqUser?.email || "").toLowerCase();
  if (!req.hqUser || (req.hqUser.role !== "owner" && email !== "service@ifcdc.org")) {
    return res.status(403).json({ error: "Founder Mode required" });
  }
  const { sendBrandedEmail } = await import("../hq/emailEngine");
  const templateId = String(req.body?.templateId || "aura_message");
  const to = String(req.body?.to || "").trim();
  if (!to) return res.status(400).json({ error: "to is required" });
  const result = await sendBrandedEmail({
    to,
    templateId: templateId as import("../hq/emailTemplates").EmailTemplateId,
    template: {
      recipientName: req.body?.recipientName,
      message: req.body?.message,
      subjectOverride: req.body?.subject,
      fields: req.body?.fields || {},
      cta: req.body?.cta,
    },
  });
  res.status(result.success ? 200 : 502).json(result);
});

router.post("/email/test-branded", hqAuthRequired, async (req: Request, res: Response) => {
  const email = (req.hqUser?.email || "").toLowerCase();
  if (!req.hqUser || (req.hqUser.role !== "owner" && email !== "service@ifcdc.org")) {
    return res.status(403).json({ error: "Founder Mode required" });
  }
  const { sendAuraGeneratedEmail, getSenderAuthStatus } = await import("../hq/emailEngine");
  const to = String(req.body?.to || req.hqUser.email || "service@ifcdc.org").trim();
  const [senderAuth, send] = await Promise.all([
    getSenderAuthStatus(),
    sendAuraGeneratedEmail({
      to,
      intent: String(req.body?.intent || "Confirm IFCDC Headquarters branded email engine is live in production"),
      context: "Founder requested a live end-to-end branded email verification from the production Email Engine.",
      module: "executive",
      recipientName: "Fahreal Allah",
      subjectHint: "IFCDC Headquarters — branded email engine verification",
    }),
  ]);
  res.status(send.success ? 200 : 502).json({
    ok: send.success,
    send,
    senderAuth,
    trustedSender: senderAuth.trustedSender,
    unverifiedSenderRisk: senderAuth.usedFallback || !senderAuth.domainVerified,
  });
});

router.get("/platform/services", hqAuthRequired, async (_req, res) => {
  const services = await checkIfcdcServices();
  res.json({ services, timestamp: new Date().toISOString() });
});

router.get("/executive/overview", hqAuthRequired, requireHQModule("executive"), async (req, res) => {
  try {
    const { buildExecutiveOverviewSafe } = await import("../hq/executiveOverviewEngine");
    res.json(await buildExecutiveOverviewSafe(req.hqUser));
  } catch (error) {
    console.error("Executive overview route error:", error);
    const { emptyExecutiveOverview } = await import("../hq/executiveOverviewEngine");
    res.json(
      emptyExecutiveOverview({
        role: req.hqUser?.role,
        hqRole: req.hqUser ? toHQRole(req.hqUser.role) : null,
      })
    );
  }
});

const softwareDivisionCache = createPackageCache<{ apps: unknown[]; timestamp: string }>(30_000);

router.get("/software-division", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  try {
    const payload = await softwareDivisionCache.get("all", async () => {
      const [healthResults, registered, registry] = await Promise.all([
        Promise.race([
          pollAllApps(),
          new Promise<Awaited<ReturnType<typeof pollAllApps>>>((resolve) =>
            setTimeout(() => resolve([]), 8_000)
          ),
        ]),
        listRegisteredApps(),
        getSoftwareDivisionApps(),
      ]);
      const registeredMap = new Map(registered.map((r) => [r.id, r]));

      const mergedApps = registry.map((app) => {
        const health = healthResults.find((h) => h.id === app.id);
        return {
          ...app,
          version: app.version ?? "1.0.0",
          health: health ?? {
            id: app.id,
            healthy: false,
            latencyMs: 0,
            version: app.version,
            error: "Health check timed out or unavailable",
          },
          registered: Boolean(registeredMap.get(app.id)),
          apiKeyPrefix: registeredMap.get(app.id)?.api_key_prefix,
          onboardedAt: registeredMap.get(app.id)?.created_at,
        };
      });

      return { apps: mergedApps, timestamp: new Date().toISOString() };
    });
    res.json(payload);
  } catch (error) {
    console.error("Software division error:", error);
    const registry = await getSoftwareDivisionApps();
    res.json({
      apps: registry.map((app) => ({
        ...app,
        version: app.version ?? "1.0.0",
        health: { id: app.id, healthy: false, latencyMs: 0, error: "Software Division API degraded" },
        registered: false,
      })),
      timestamp: new Date().toISOString(),
      degraded: true,
    });
  }
});

router.get("/software-division/diagnostics", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  try {
    const diagnostics = await runAllAppDiagnostics();
    res.json({ diagnostics, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("All diagnostics error:", error);
    res.status(500).json({ error: "Failed to run diagnostics" });
  }
});

router.get("/software-division/:appId/diagnostics", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    const diagnostics = await runAppDiagnostics(req.params.appId);
    res.json(diagnostics);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Diagnostics failed" });
  }
});

router.get("/software-division/registry", hqAuthRequired, (_req, res) => {
  res.json({ apps: SOFTWARE_DIVISION_APPS });
});

router.get("/software-division/framework", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  try {
    const framework = await buildSoftwareDivisionFramework();
    res.json(framework);
  } catch (error) {
    console.error("Software division framework error:", error);
    res.status(500).json({ error: "Failed to load integration framework" });
  }
});

router.post("/software-division/register", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    const { id, name, healthUrl, launchUrl, description } = req.body ?? {};
    if (!id || !name || !healthUrl) {
      return res.status(400).json({ error: "id, name, and healthUrl are required" });
    }
    if (!/^[a-z0-9-]+$/.test(String(id))) {
      return res.status(400).json({ error: "id must be lowercase alphanumeric with hyphens only" });
    }

    const { app, apiKey } = await registerSoftwareApp({
      id: String(id),
      name: String(name),
      description: description ? String(description) : undefined,
      healthUrl: String(healthUrl),
      launchUrl: launchUrl ? String(launchUrl) : undefined,
      createdBy: req.hqUser!.id,
    });

    await logDeveloperAudit({
      appId: app.id,
      eventType: "app.registered",
      actorId: req.hqUser!.id,
      actorEmail: req.hqUser!.email,
      detail: `Registered ${app.name} via Software Division`,
    });

    softwareDivisionCache.clear();
    notifyHqDataChange("software");

    res.status(201).json({
      message: "Application registered with IFCDC Headquarters",
      app: {
        id: app.id,
        name: app.name,
        healthUrl: app.health_url,
        launchUrl: app.launch_url,
        status: app.status,
        apiKeyPrefix: app.api_key_prefix,
      },
      credentials: {
        appId: app.id,
        apiKey,
        apiKeyPrefix: app.api_key_prefix,
        warning: "Store this API key securely — it will not be shown again.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    res.status(message.includes("already registered") ? 409 : 400).json({ error: message });
  }
});

router.patch("/software-division/apps/:appId", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    const app = await updateSoftwareApp(req.params.appId, {
      name: req.body?.name,
      description: req.body?.description,
      healthUrl: req.body?.healthUrl,
      launchUrl: req.body?.launchUrl,
      status: req.body?.status,
    });
    softwareDivisionCache.clear();
    notifyHqDataChange("software");
    res.json({
      app: {
        id: app.id,
        name: app.name,
        description: app.description,
        healthUrl: app.health_url,
        launchUrl: app.launch_url,
        status: app.status,
        apiKeyPrefix: app.api_key_prefix,
        updatedAt: app.updated_at,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Update failed" });
  }
});

router.delete("/software-division/apps/:appId", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    await deleteSoftwareApp(req.params.appId);
    softwareDivisionCache.clear();
    notifyHqDataChange("software");
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Delete failed" });
  }
});

router.post("/aura/chat", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { message, context, mode } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const orgContext = await buildAuraExecutiveContext(context);
    const modePrefix = mode === "summarize"
      ? "Summarize the following as an executive brief with key findings and recommended actions:\n"
      : mode === "recommend"
        ? "Provide strategic recommendations for IFCDC leadership based on:\n"
        : "";

    const response = await auraExecutiveChat(modePrefix + message, orgContext);
    res.json({ response, poweredBy: "AURA Enterprise", mode: mode ?? "chat" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AURA assistant unavailable";
    console.error("AURA HQ chat error:", message);
    res.status(/401|api key/i.test(message) ? 400 : 500).json({ error: message });
  }
});

router.post("/aura/summarize", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { reportType } = req.body;
    const context = await buildAuraExecutiveContext();
    const prompt = reportType === "financial"
      ? "Generate an executive financial summary covering revenue, cash flow, donations, expenses, and budget health."
      : reportType === "grants"
        ? "Generate an executive grant portfolio summary covering active awards, pipeline, compliance, and win rate."
        : reportType === "operations"
          ? "Generate an executive operations summary covering housing, scholarships, fleet, facilities, compliance risks, and calendar."
          : "Generate a comprehensive executive organization summary covering all IFCDC Headquarters modules.";
    const response = await auraExecutiveChat(prompt, context);
    res.json({ summary: response, reportType: reportType ?? "full", generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA summarize error:", error);
    res.status(500).json({ error: "AURA summary unavailable" });
  }
});

router.post("/aura/recommend", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const context = await buildAuraExecutiveContext();
    const response = await auraExecutiveChat(
      "As IFCDC's executive AI advisor, provide exactly 5 prioritized strategic recommendations for the founder. Each should include: priority level (High/Medium/Low), action, rationale, and which HQ module to use.",
      context
    );
    res.json({ recommendations: response, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA recommend error:", error);
    res.status(500).json({ error: "AURA recommendations unavailable" });
  }
});

router.post("/aura/forecast", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const [trends, context] = await Promise.all([
      buildPredictiveTrends(),
      buildAuraExecutiveContext(),
    ]);
    const response = await auraExecutiveChat(
      "As IFCDC's executive AI advisor, provide a 6-month organizational forecast covering: financial outlook, grant pipeline, people/HR capacity, operations risks, and software division health. Include confidence levels and key decision points for leadership.",
      context
    );
    res.json({ forecast: response, trends, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA forecast error:", error);
    res.status(500).json({ error: "AURA forecast unavailable" });
  }
});

router.post("/aura/compliance", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const context = await buildAuraExecutiveContext();
    const response = await auraExecutiveChat(
      "Review IFCDC compliance status across grants, operations risks, HR certifications, and policy requirements. List overdue items, high-risk gaps, and recommended actions with deadlines for leadership.",
      context
    );
    res.json({ review: response, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA compliance error:", error);
    res.status(500).json({ error: "AURA compliance review unavailable" });
  }
});

router.post("/aura/briefing", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const context = await buildAuraExecutiveContext();
    const focus = req.body?.focus ?? "daily";
    const prompt = focus === "board"
      ? "Generate a board-ready executive briefing covering governance, financial position, grant portfolio, program impact, and strategic priorities."
      : "Generate a founder morning briefing: top 5 priorities, financial snapshot, grant deadlines, people/HR alerts, program performance, and recommended actions for today.";
    const response = await auraExecutiveChat(prompt, context);
    res.json({ briefing: response, focus, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA briefing error:", error);
    res.status(500).json({ error: "AURA briefing unavailable" });
  }
});

router.get("/aura/status", hqAuthRequired, async (_req, res) => {
  const core = getAuraProductionCoreStatus();
  const services = await checkIfcdcServices();
  const { getLegacy4101Summary } = await import("../hq/auraLegacy4101");
  res.json({
    /** Production AURA readiness — in-process OpenAI (Phase 7). Not :4101. */
    auraCore: core.ready,
    productionPath: core.path,
    legacy4101: getLegacy4101Summary(),
    /** Sidecar health bit — false when Phase 7 skips probing (expected). */
    legacySidecarReachable: services.aura === true,
    model: core.model,
    capabilities: [
      "executive_reports",
      "organization_qa",
      "report_summaries",
      "strategic_recommendations",
      "compliance_review",
      "executive_briefings",
      "budget_monitoring",
      "document_awareness",
      "hr_assistance",
      "grant_writing",
      "financial_summaries",
      "predictive_insights",
      "app_monitoring",
      "workflow_automation",
      "module_search",
      "department_monitoring",
      "anomaly_detection",
      "financial_risk_prediction",
      "compliance_tracking",
      "executive_summaries",
    ],
  });
});

router.post("/aura/search", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters" });
  res.json({ results: await searchHqModules(query), query });
});

router.get("/aura/departments", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  const summary = await buildDepartmentMonitoringSummary();
  res.json({ summary, generatedAt: new Date().toISOString() });
});

router.get("/aura/anomalies", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await detectOperationalAnomalies());
});

router.get("/aura/financial-risk", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await predictFinancialRisk());
});

router.get("/aura/compliance-tracker", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await trackComplianceDeadlines());
});

router.post("/aura/executive-summary", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  const summary = await generateAuraExecutiveSummary();
  res.json({ summary, generatedAt: new Date().toISOString() });
});

router.post("/aura/enterprise/ask", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  const context = String(req.body?.context ?? "").trim() || undefined;
  res.json(await answerEnterpriseQuestion(question, context));
});

router.get("/aura/enterprise/insights", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await getAuraModuleInsights());
});

router.get("/aura/enterprise/board-report", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await generateEnterpriseBoardReport());
});

router.post("/aura/operations/ask", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  const moduleHint = String(req.body?.module ?? "").trim() || undefined;
  res.json(await askOperationsCopilot(question, moduleHint));
});

router.get("/aura/operations/briefing", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await getOperationsCopilotBriefing());
});

router.get("/aura/executive/health", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await buildExecutiveHealthSummary());
});

/** AURA MUSIC local production-node health (Founder Mac). Safe on Render — never probes public ports. */
router.get("/aura/music/health", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getAuraMusicHealthSummary } = await import("../hq/auraMusicHealth");
    res.json(await getAuraMusicHealthSummary());
  } catch (error) {
    console.error("GET /aura/music/health error:", error);
    res.status(500).json({ error: "AURA MUSIC health unavailable" });
  }
});

/** AURA Resolve board. Browser talks to HQ only. The bridge stays on 127.0.0.1. */
router.get("/aura/resolve/status", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const {
      getAuraResolveNodeSnapshot,
      listAuraResolveJobs,
      readLocalResolveBridge,
      listAuraResolvePreviews,
      listAuraResolveCreativeMemory,
    } = await import("../hq/auraResolveProductionNode");
    const node = await getAuraResolveNodeSnapshot();
    const local = await readLocalResolveBridge();
    const macOnline = Boolean(node.online);
    // Never treat a stale heartbeat JSON as live once the Mac TTL expires.
    const beat = macOnline ? ((node.heartbeat || {}) as Record<string, any>) : ({} as Record<string, any>);
    const live = macOnline
      ? ((local?.api as { result?: Record<string, any> } | undefined)?.result || beat.resolve || {})
      : {};
    const jobs = await listAuraResolveJobs(node.nodeId);
    const current = jobs.find((job) => job.status === "claimed") || jobs.find((job) => job.status === "queued") || null;
    const render = beat.render || live.render || {};
    const bridgeOnline = macOnline && Boolean(local?.api || beat.bridge === "ONLINE");
    const resolveOnline =
      macOnline &&
      Boolean(live.resolve === "ONLINE" || local?.resolveRunning || beat.resolveRunning);
    const previews = await listAuraResolvePreviews();
    const memory = await listAuraResolveCreativeMemory(12);
    const { getFounderIntakeStatus } = await import("../hq/auraResolveFounderIntake");
    const cloudIntake = getFounderIntakeStatus();
    const macFounder = beat.founderIdentity || null;
    const founderIdentity = {
      ...cloudIntake,
      // Mac heartbeat designations remain informational; HQ cloud is the phone intake source of truth.
      macHeartbeat: macFounder
        ? {
            FOUNDATION_MEDIA_MISSING: Boolean(macFounder.FOUNDATION_MEDIA_MISSING),
            slots: macFounder.designations?.slots || macFounder.designations || null,
          }
        : null,
    };
    const memoryCompany =
      (beat.creativeMemory as { company?: string; productionCompany?: string; productionIdentity?: string } | undefined)
        ?.productionCompany ||
      (beat.creativeMemory as { company?: string } | undefined)?.company ||
      "IFCDC PRODUCTIONS";
    res.json({
      ok: true,
      publicExposure: false,
      company: memoryCompany,
      productionCompany: "IFCDC PRODUCTIONS",
      productionIdentity: "IFCDC PRODUCTION",
      brandPromoted:
        (beat.creativeMemory as { brandPromoted?: string } | undefined)?.brandPromoted ||
        (current as { result?: { brandPromoted?: string } } | null)?.result?.brandPromoted ||
        null,
      bridge: bridgeOnline ? "ONLINE" : "OFFLINE",
      resolve: resolveOnline ? "ONLINE" : "OFFLINE",
      resolveVersion: macOnline
        ? live.version || (local?.resolve as { version?: string } | undefined)?.version || beat.resolveVersion || null
        : null,
      productionMac: macOnline ? "ONLINE" : "OFFLINE",
      project: macOnline ? live.project || beat.project || null : null,
      timeline: macOnline ? live.timeline || beat.timeline || null : null,
      currentJob: current,
      renderStatus: macOnline ? render.status || beat.renderStatus || "idle" : "idle",
      renderPercent: macOnline ? render.percent ?? beat.renderPercent ?? null : null,
      queue: jobs.filter((job) => job.status === "queued" || job.status === "claimed"),
      assets: macOnline ? beat.assets || [] : [],
      completedRenders: macOnline ? beat.completedRenders || [] : [],
      previews,
      creativeMemory: memory,
      brandKit: beat.brandKit || null,
      gate: beat.creativeMemory?.currentGate || "IDEA",
      gateStates: [
        "IDEA",
        "PLAN",
        "GENERATE",
        "BUILD",
        "DRAFT",
        "HQ_PREVIEW",
        "FOUNDER_REVISION",
        "FOUNDER_APPROVAL",
        "MASTER",
        "DISTRIBUTION_AUTHORIZATION",
      ],
      publish: false,
      distributionBlocked: true,
      phase: "6B",
      errors: macOnline ? beat.errors || [] : [],
      notes: beat.notes || [
        "Publishing stays off until Founder approval.",
        "IFCDC PRODUCTIONS applies automatically to every project.",
        "brandPromoted is the product/program — separate from the production company.",
        "Phase 6B: Founder/official intake on HQ; generative video awaits Founder provider decision; never invent media.",
      ],
      lastHeartbeat: node.lastSeenAt,
      heartbeatAgeMs: node.ageMs ?? null,
      heartbeatTtlMs: node.heartbeatTtlMs ?? 45_000,
      lastSuccessfulCommand: beat.lastSuccessfulCommand || jobs.find((job) => job.status === "complete") || null,
      jobs,
      generation: beat.generation || null,
      pipeline: beat.pipeline || null,
      continuity: beat.continuity || null,
      assetLibrary: beat.assetLibrary || null,
      productionKitSlots: beat.productionKitSlots || beat.brandKit?.productionKitSlots || null,
      founderIdentity,
      clonePrep: beat.clonePrep || {
        status: "ARCHITECTURE_READY",
        generationEngine: "NOT_EXECUTED_FOR_PERSON",
        founderIdentityLibrary: "READY_FOR_APPROVED_UPLOADS",
        ORIGINAL_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/ORIGINAL_FOUNDER_MEDIA",
        GENERATED_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/GENERATED_FOUNDER_MEDIA",
        approvedPhotosVideoVoice: "WAITING_FOR_APPROVED_MEDIA",
        generatedScenesTakes: "STORAGE_READY_NO_GENERATION",
        identityConsistency: "DEFINED",
        wardrobeEnvironment: "REFERENCE_DIRS_READY",
        roleTransformation: "REFERENCE_DIRS_READY",
        provenance: "ACTIVE",
        foundationMediaMissing: true,
      },
    });
  } catch (error) {
    console.error("GET /aura/resolve/status error:", error);
    res.status(200).json({
      ok: false,
      publicExposure: false,
      bridge: "OFFLINE",
      resolve: "OFFLINE",
      productionMac: "OFFLINE",
      error: "Resolve status temporarily unavailable",
      jobs: [],
      queue: [],
      previews: [],
    });
  }
});

/** Phase 6 / 6C — provider discovery (no secrets). */
router.get("/aura/resolve/providers", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { discoverGenerativeProviders, listCloudGenerationJobs } = await import("../hq/auraResolveGenerativeProviders");
    const { runwayApiKeyPresence } = await import("../hq/runwayVideoProvider");
    const deep = String(req.query.deep || "") === "1";
    const discovery = await discoverGenerativeProviders({ deep });
    res.json({
      ok: true,
      phase: "6C",
      publish: false,
      RUNWAY_API_KEY_PRESENT: runwayApiKeyPresence(),
      discovery,
      jobs: listCloudGenerationJobs(20),
    });
  } catch (error) {
    console.error("GET /aura/resolve/providers error:", error);
    res.status(500).json({ ok: false, error: "Provider discovery unavailable" });
  }
});

/** Phase 6 / 6C — cloud-side generation proof / HQ control (non-person only). */
router.post("/aura/resolve/generate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    if (req.body?.publish === true) {
      res.status(403).json({ ok: false, error: "publishing requires Founder approval and is not available", publish: false });
      return;
    }
    const { executeCloudGeneration } = await import("../hq/auraResolveGenerativeProviders");
    const capability = String(req.body?.capability || "image_generation");
    const result = await executeCloudGeneration(capability, {
      ...(req.body?.request || {}),
      prompt: req.body?.prompt,
      text: req.body?.text,
      title: req.body?.title,
      subtitle: req.body?.subtitle,
      imageBase64: req.body?.imageBase64 || req.body?.request?.imageBase64,
      imageMimeType: req.body?.imageMimeType || req.body?.request?.imageMimeType,
      durationSeconds: req.body?.durationSeconds ?? req.body?.request?.durationSeconds ?? 2,
      ratio: req.body?.ratio || req.body?.request?.ratio,
      fileName: req.body?.fileName || req.body?.request?.fileName,
      project: req.body?.project || req.body?.request?.project,
      person: false,
    });

    // Queue Mac library + Resolve ingest for generated video (local file ingest; no extra Runway credits).
    let macIngest: unknown = null;
    if (result.ok && result.kind === "provider_video" && req.body?.ingestToMac !== false) {
      try {
        const { getAuraResolveNodeSnapshot, queueAuraResolveCommand } = await import("../hq/auraResolveProductionNode");
        const node = await getAuraResolveNodeSnapshot();
        if (node.nodeId && node.online && result.fileBase64) {
          macIngest = await queueAuraResolveCommand(node.nodeId, "ingest_generated_media", {
            fileName: result.fileName,
            base64: result.fileBase64,
            project: req.body?.project || "IFCDC-PHASE6C-RUNWAY",
            instruction: String(req.body?.prompt || "").slice(0, 240),
            durationSeconds: result.durationSeconds ?? 2,
            // HQ already stored preview during generate — avoid duplicate upload unless asked.
            uploadPreview: req.body?.reuploadPreview === true,
            publish: false,
          });
        }
      } catch {
        macIngest = null;
      }
    }

    // Never return giant base64 to browser by default — keep metadata + job id.
    const { fileBase64, ...safe } = result as Record<string, unknown>;
    res.json({
      ok: Boolean(result.ok),
      publish: false,
      phase: "6C",
      ...safe,
      hasBytes: Boolean(fileBase64),
      macIngest,
      message: result.ok
        ? result.kind === "provider_video"
          ? "Runway video written on HQ + HQ preview stored. Mac ingest queued when Production Mac is online."
          : "Provider media written on HQ. Queue Start production on Mac for Resolve ingest + draft preview."
        : result.reason || result.blocker,
    });
  } catch (error) {
    console.error("POST /aura/resolve/generate error:", error);
    res.status(500).json({ ok: false, error: "Generation failed" });
  }
});

/** Phase 6B — Founder / official asset intake: store on HQ; optionally mirror to Production Mac. */
router.post("/aura/resolve/founder-identity/designate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    if (req.body?.publish === true) {
      res.status(403).json({ ok: false, publish: false, error: "publishing blocked" });
      return;
    }
    const slotId = String(req.body?.slotId || "").trim();
    if (!slotId) {
      res.status(400).json({ ok: false, error: "slotId required" });
      return;
    }
    const { designateFounderIntake, getFounderIntakeStatus } = await import("../hq/auraResolveFounderIntake");
    const stored = designateFounderIntake({
      slotId,
      base64: req.body?.base64 || null,
      originalName: req.body?.originalName || null,
      mimeType: req.body?.mimeType || null,
    });
    if (!stored.ok) {
      res.status(400).json({ ok: false, publish: false, phase: "6B", ...stored });
      return;
    }

    let macQueued: unknown = null;
    try {
      const { getAuraResolveNodeSnapshot, queueAuraResolveCommand } = await import("../hq/auraResolveProductionNode");
      const node = await getAuraResolveNodeSnapshot();
      if (node.nodeId && node.online) {
        macQueued = await queueAuraResolveCommand(node.nodeId, "designate_founder_media", {
          slotId,
          base64: req.body?.base64 || null,
          originalName: req.body?.originalName || null,
          mimeType: req.body?.mimeType || null,
          publish: false,
        });
      }
    } catch {
      macQueued = null;
    }

    res.json({
      ok: true,
      publish: false,
      phase: "6B",
      generationExecuted: false,
      stored,
      macQueued,
      founderIdentity: getFounderIntakeStatus(),
      message: macQueued
        ? `Designated ${slotId} on HQ and queued Mac mirror. Originals are never overwritten. No face/voice is generated.`
        : `Designated ${slotId} on HQ. Production Mac offline/unenrolled — cloud original stored. No face/voice is generated.`,
    });
  } catch (error) {
    console.error("POST /aura/resolve/founder-identity/designate error:", error);
    res.status(500).json({ ok: false, error: "Designation failed" });
  }
});

router.get("/aura/resolve/founder-identity", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getFounderIntakeStatus } = await import("../hq/auraResolveFounderIntake");
    res.json({ ok: true, phase: "6B", publish: false, founderIdentity: getFounderIntakeStatus() });
  } catch (error) {
    console.error("GET /aura/resolve/founder-identity error:", error);
    res.status(500).json({ ok: false, error: "Founder identity status unavailable" });
  }
});

/** Production Mac → HQ OpenAI media proxy (node auth). */
router.post("/aura/resolve/node/generate", async (req, res) => {
  try {
    const { authenticateAuraResolveNode } = await import("../hq/auraResolveProductionNode");
    const node = await authenticateAuraResolveNode(req);
    if (!node) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const { executeCloudGeneration } = await import("../hq/auraResolveGenerativeProviders");
    const capability = String(req.body?.capability || "");
    const result = await executeCloudGeneration(capability, { ...(req.body?.request || {}), person: false });
    res.json(result);
  } catch (error) {
    console.error("POST /aura/resolve/node/generate error:", error);
    res.status(500).json({ ok: false, status: "FAILED", blocker: "PROVIDER_ERROR:hq_proxy" });
  }
});

router.post("/aura/resolve/jobs", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getAuraResolveNodeSnapshot, queueAuraResolveCommand, AURA_RESOLVE_COMMANDS } = await import(
    "../hq/auraResolveProductionNode"
  );
  const command = String(req.body?.command || "");
  if (!AURA_RESOLVE_COMMANDS.includes(command as (typeof AURA_RESOLVE_COMMANDS)[number])) {
    res.status(400).json({ ok: false, error: "command is not allowlisted" });
    return;
  }
  if (req.body?.payload?.publish === true || req.body?.publish === true) {
    res.status(403).json({ ok: false, error: "publishing requires Founder approval and is not available", publish: false });
    return;
  }
  const node = await getAuraResolveNodeSnapshot();
  if (!node.nodeId) {
    res.status(409).json({ ok: false, error: "Production Mac is not enrolled" });
    return;
  }
  const queued = await queueAuraResolveCommand(node.nodeId, command, { ...(req.body?.payload || {}), publish: false });
  res.json({ ok: true, publish: false, queued });
});

router.post("/aura/resolve/jobs/:id/cancel", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { cancelAuraResolveJob } = await import("../hq/auraResolveProductionNode");
  res.json({ ok: true, ...(await cancelAuraResolveJob(String(req.params.id))) });
});

router.post("/aura/resolve/plan", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const instruction = String(req.body?.instruction || "");
  const { getAuraResolveNodeSnapshot, queueAuraResolveCommand, recordAuraResolveCreativeMemory } = await import(
    "../hq/auraResolveProductionNode"
  );
  const { planAuraCreativeInstruction } = await import("../hq/auraResolveCreativePlanner");
  const plan = planAuraCreativeInstruction(instruction);
  const node = await getAuraResolveNodeSnapshot();
  if (!node.nodeId) {
    res.status(200).json({
      ok: false,
      publish: false,
      plan,
      message: "No Resolve production node is enrolled yet.",
    });
    return;
  }
  await recordAuraResolveCreativeMemory("plan", {
    instruction,
    project: plan.project,
    company: "IFCDC PRODUCTIONS",
    productionCompany: plan.productionCompany,
    productionIdentity: plan.productionIdentity,
    brandPromoted: plan.brandPromoted,
  });
  const queued = await queueAuraResolveCommand(node.nodeId, "editor_plan", { instruction, publish: false });
  res.json({
    ok: true,
    publish: false,
    company: "IFCDC PRODUCTIONS",
    productionCompany: plan.productionCompany,
    productionIdentity: plan.productionIdentity,
    brandPromoted: plan.brandPromoted,
    plan,
    pipeline: plan.PIPELINE,
    generation: plan.GENERATION,
    continuity: plan.CONTINUITY,
    librarySearch: plan.LIBRARY_SEARCH,
    assetGaps: plan.ASSET_GAPS,
    queued,
    message: "Phase 6 plan ready. Start production to generate configured assets / build the draft on the Production Mac.",
  });
});

router.post("/aura/resolve/produce", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const instruction = String(req.body?.instruction || "");
  if (!instruction.trim()) {
    res.status(400).json({ ok: false, error: "instruction required" });
    return;
  }
  if (req.body?.publish === true) {
    res.status(403).json({ ok: false, error: "publishing requires Founder approval and is not available", publish: false });
    return;
  }
  const { getAuraResolveNodeSnapshot, queueAuraResolveCommand, recordAuraResolveCreativeMemory } = await import(
    "../hq/auraResolveProductionNode"
  );
  const { planAuraCreativeInstruction } = await import("../hq/auraResolveCreativePlanner");
  const plan = planAuraCreativeInstruction(instruction);
  const node = await getAuraResolveNodeSnapshot();
  if (!node.nodeId) {
    res.status(409).json({ ok: false, error: "Production Mac is not enrolled" });
    return;
  }
  await recordAuraResolveCreativeMemory("produce", {
    instruction,
    project: plan.project,
    company: "IFCDC PRODUCTIONS",
    productionCompany: plan.productionCompany,
    productionIdentity: plan.productionIdentity,
    brandPromoted: plan.brandPromoted,
  });
  const queued = await queueAuraResolveCommand(node.nodeId, "editor_run", {
    instruction,
    projectName: plan.project,
    publish: false,
    draft: true,
    masterFormatsAfter: req.body?.masterFormatsAfter === true,
  });
  res.json({
    ok: true,
    publish: false,
    company: "IFCDC PRODUCTIONS",
    productionCompany: plan.productionCompany,
    productionIdentity: plan.productionIdentity,
    brandPromoted: plan.brandPromoted,
    plan,
    queued,
    message: "IFCDC PRODUCTION queued on the Production Mac. Draft only.",
  });
});

router.post("/aura/resolve/revise", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const instruction = String(req.body?.instruction || "");
  const revisionNote = String(req.body?.revisionNote || req.body?.note || "").trim();
  if (!instruction.trim() || !revisionNote) {
    res.status(400).json({ ok: false, error: "instruction and revisionNote required" });
    return;
  }
  if (req.body?.publish === true) {
    res.status(403).json({ ok: false, error: "publishing requires Founder approval and is not available", publish: false });
    return;
  }
  const { getAuraResolveNodeSnapshot, queueAuraResolveCommand, recordAuraResolveCreativeMemory } = await import(
    "../hq/auraResolveProductionNode"
  );
  const { parseAuraRevisionNote } = await import("../hq/auraResolveCreativePlanner");
  const parsed = parseAuraRevisionNote(revisionNote);
  const node = await getAuraResolveNodeSnapshot();
  if (!node.nodeId) {
    res.status(409).json({ ok: false, error: "Production Mac is not enrolled" });
    return;
  }
  await recordAuraResolveCreativeMemory("revision", {
    instruction,
    revisionNote,
    intents: parsed.intents,
    dryModificationPlan: parsed.dryModificationPlan,
  });
  const queued = await queueAuraResolveCommand(node.nodeId, "request_revision", {
    instruction,
    revisionNote,
    projectName: req.body?.projectName || "IFCDC-AURA-BARBERS-PROMO-P4",
    publish: false,
  });
  res.json({
    ok: true,
    publish: false,
    company: "IFCDC PRODUCTIONS",
    revision: parsed,
    queued,
    message: `Revision queued (${parsed.intents.join(", ")}). Draft only.`,
  });
});

router.post("/aura/resolve/master-formats", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  if (req.body?.publish === true) {
    res.status(403).json({ ok: false, error: "publishing requires Founder approval and is not available", publish: false });
    return;
  }
  const { getAuraResolveNodeSnapshot, queueAuraResolveCommand, recordAuraResolveCreativeMemory } = await import(
    "../hq/auraResolveProductionNode"
  );
  const node = await getAuraResolveNodeSnapshot();
  if (!node.nodeId) {
    res.status(409).json({ ok: false, error: "Production Mac is not enrolled" });
    return;
  }
  const sourceProject = String(req.body?.sourceProject || "IFCDC-AURA-BARBERS-PROMO-V1");
  const projectName = String(req.body?.projectName || "IFCDC-AURA-BARBERS-PROMO-P4");
  await recordAuraResolveCreativeMemory("master_formats", { sourceProject, projectName });
  const queued = await queueAuraResolveCommand(node.nodeId, "master_formats", {
    sourceProject,
    projectName,
    publish: false,
  });
  res.json({
    ok: true,
    publish: false,
    company: "IFCDC PRODUCTIONS",
    queued,
    message: "Multi-format mastering queued from existing master (9:16 / 16:9 / 1:1). Draft only.",
  });
});

router.get("/aura/resolve/preview/:id", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getAuraResolvePreview } = await import("../hq/auraResolveProductionNode");
  const preview = await getAuraResolvePreview(String(req.params.id));
  if (!preview) {
    res.status(404).json({ ok: false, error: "preview not found" });
    return;
  }
  res.setHeader("Content-Type", preview.contentType);
  res.setHeader("Content-Length", String(preview.size));
  res.setHeader("Content-Disposition", `inline; filename="${preview.name}"`);
  res.setHeader("Cache-Control", "private, max-age=60");
  res.send(preview.bytes);
});

router.post("/aura/resolve/node/claim", async (req, res) => {
  try {
    const { claimFirstAuraResolveNode } = await import("../hq/auraResolveProductionNode");
    const result = await claimFirstAuraResolveNode({
      nodeId: String(req.body?.nodeId || ""),
      token: String(req.body?.token || ""),
      label: String(req.body?.label || "Founder Mac Resolve Node"),
      hostname: String(req.body?.hostname || ""),
    });
    if (!result.ok) {
      res.status(403).json(result);
      return;
    }
    res.status(201).json({ ok: true, nodeId: result.nodeId, publicExposure: false });
  } catch (error) {
    console.error("POST /aura/resolve/node/claim error:", error);
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Resolve node claim unavailable",
    });
  }
});

router.post("/aura/resolve/node/claim-local", async (req, res) => {
  const address = req.socket.remoteAddress || "";
  if (address !== "127.0.0.1" && address !== "::1" && !address.endsWith("127.0.0.1")) {
    res.status(403).json({ ok: false, error: "local claim only" });
    return;
  }
  const { enrollAuraResolveNode } = await import("../hq/auraResolveProductionNode");
  const enrolled = await enrollAuraResolveNode({ label: "Founder Mac Resolve Node", hostname: "production-mac" });
  res.json({ ...enrolled, publicExposure: false });
});

router.post("/aura/resolve/node/enroll", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { enrollAuraResolveNode } = await import("../hq/auraResolveProductionNode");
  const enrolled = await enrollAuraResolveNode({
    label: String(req.body?.label || "Founder Mac Resolve Node"),
    hostname: String(req.body?.hostname || ""),
  });
  res.json({ ...enrolled, publicExposure: false });
});

router.post("/aura/resolve/node/heartbeat", async (req, res) => {
  try {
    const { authenticateAuraResolveNode, recordAuraResolveHeartbeat, claimAuraResolveCommands } = await import(
      "../hq/auraResolveProductionNode"
    );
    const node = await authenticateAuraResolveNode(req);
    if (!node) {
      res.status(401).json({ ok: false, error: "resolve node token rejected" });
      return;
    }
    await recordAuraResolveHeartbeat(node.nodeId, req.body || {});
    const commands = await claimAuraResolveCommands(node.nodeId);
    res.json({ ok: true, commands, publicExposure: false });
  } catch (error) {
    console.error("POST /aura/resolve/node/heartbeat error:", error);
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Resolve heartbeat unavailable",
      commands: [],
      publicExposure: false,
    });
  }
});

router.post("/aura/resolve/node/complete", async (req, res) => {
  try {
    const { authenticateAuraResolveNode, completeAuraResolveCommand } = await import("../hq/auraResolveProductionNode");
    const node = await authenticateAuraResolveNode(req);
    if (!node) {
      res.status(401).json({ ok: false, error: "resolve node token rejected" });
      return;
    }
    await completeAuraResolveCommand(String(req.body?.id || ""), req.body?.result || {});
    res.json({ ok: true });
  } catch (error) {
    console.error("POST /aura/resolve/node/complete error:", error);
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Resolve complete unavailable",
    });
  }
});

router.post("/aura/resolve/node/preview", async (req, res) => {
  try {
    const { authenticateAuraResolveNode, storeAuraResolvePreview } = await import("../hq/auraResolveProductionNode");
    const node = await authenticateAuraResolveNode(req);
    if (!node) {
      res.status(401).json({ ok: false, error: "resolve node token rejected" });
      return;
    }
    if (req.body?.publish === true) {
      res.status(403).json({ ok: false, error: "publishing requires Founder approval and is not available", publish: false });
      return;
    }
    const stored = await storeAuraResolvePreview({
      name: String(req.body?.name || "draft.mp4"),
      project: req.body?.project ? String(req.body.project) : null,
      instruction: req.body?.instruction ? String(req.body.instruction) : null,
      duration: typeof req.body?.duration === "number" ? req.body.duration : null,
      contentType: String(req.body?.contentType || "video/mp4"),
      base64: String(req.body?.base64 || ""),
      size: typeof req.body?.size === "number" ? req.body.size : undefined,
    });
    res.status(201).json(stored);
  } catch (error) {
    console.error("POST /aura/resolve/node/preview error:", error);
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Resolve preview upload unavailable",
      publish: false,
    });
  }
});

/** AURA MUSIC Command Center payload for HQ UI (local status file or clear cloud offline). */
router.get("/aura/music/command-center", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getAuraMusicCommandCenter } = await import("../hq/auraMusicHealth");
    res.json(await getAuraMusicCommandCenter());
  } catch (error) {
    console.error("GET /aura/music/command-center error:", error);
    res.status(200).json({
      ok: false,
      configured: false,
      mode: "cloud_hq",
      auraMusicReady: false,
      publicExposure: false,
      message: "AURA MUSIC command center temporarily unavailable",
      generatedAt: new Date().toISOString(),
      services: {
        musicIntelligence: "OFFLINE",
        abletonBridge: "OFFLINE",
        abletonLive: "DISCONNECTED",
        productionNode: "NOT READY",
        watchdog: "ERROR",
      },
      summary: {
        "Music Intelligence": "OFFLINE",
        "Ableton Bridge": "OFFLINE",
        "Ableton Live": "DISCONNECTED",
        "Production Node": "NOT READY",
        Watchdog: "ERROR",
      },
      currentJob: null,
      jobQueue: [],
      recentExports: [],
      phases: {
        phase1: { status: "PASS", label: "AURA ↔ Ableton Bridge" },
        phase2: { status: "PASS", label: "Audio Intelligence Foundation" },
        phase2Hardening: { status: "PASS", label: "Auto-start / recovery" },
        phase3: { status: "ACTIVE", label: "Mixing Intelligence — controlled engineering racks + Mix V1" },
      },
      sections: [],
    });
  }
});

/** FRP SPINS source — metadata/intelligence only (audio stays on production node). */
router.get("/aura/music/spins", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getAuraSpinsDashboard } = await import("../hq/auraMusicHealth");
    res.json(await getAuraSpinsDashboard());
  } catch (error) {
    console.error("GET /aura/music/spins error:", error);
    res.status(500).json({ ok: false, error: "SPINS dashboard unavailable" });
  }
});

router.get("/aura/music/founder-dna", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getFounderSoundDnaDashboard } = await import("../hq/auraMusicHealth");
    res.json(await getFounderSoundDnaDashboard());
  } catch (error) {
    console.error("GET /aura/music/founder-dna error:", error);
    res.status(500).json({ ok: false, error: "Founder Sound DNA unavailable" });
  }
});

router.get("/aura/music/current-sound", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getCurrentSoundDashboard } = await import("../hq/auraMusicHealth");
    res.json(await getCurrentSoundDashboard());
  } catch (error) {
    console.error("GET /aura/music/current-sound error:", error);
    res.status(500).json({ ok: false, error: "Current Sound Profile unavailable" });
  }
});

/** AURA DJ — Serato live dashboard (real crates / process state on Founder Mac). */
router.get("/aura/music/serato", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getLiveSeratoDashboardMerged } = await import("../hq/seratoLibrary");
    res.json(await getLiveSeratoDashboardMerged());
  } catch (error) {
    console.error("GET /aura/music/serato error:", error);
    res.status(500).json({ ok: false, error: "Serato dashboard unavailable" });
  }
});

router.get("/aura/music/serato/decks", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getSeratoDecksForHq } = await import("../hq/seratoLibrary");
    const decks = await getSeratoDecksForHq();
    if (!decks || decks.ok === false) {
      return res.status(503).json(decks || { ok: false, error: "serato_bridge_offline" });
    }
    res.json(decks);
  } catch (error) {
    console.error("GET /aura/music/serato/decks error:", error);
    res.status(500).json({ ok: false, error: "Deck state unavailable" });
  }
});

router.post("/aura/music/serato/command", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { postSeratoBridgeCommand } = await import("../hq/seratoLibrary");
    const command = String(req.body?.command || "");
    const args = (req.body?.args || {}) as Record<string, unknown>;
    const result = await postSeratoBridgeCommand(command, args);
    res.json(result);
  } catch (error) {
    console.error("POST /aura/music/serato/command error:", error);
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "serato_bridge_command_failed",
    });
  }
});

router.get("/aura/music/serato/crates/:crateId/tracks", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { getCrateTracks } = await import("../hq/seratoLibrary");
    const result = getCrateTracks(String(req.params.crateId), { probeDuration: true });
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (error) {
    console.error("GET /aura/music/serato/crates/:crateId/tracks error:", error);
    res.status(500).json({ ok: false, error: "Crate tracks unavailable" });
  }
});

router.post("/aura/music/serato/launch", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { launchSeratoDjPro, getLiveSeratoDashboardMerged } = await import("../hq/seratoLibrary");
    const launched = launchSeratoDjPro();
    res.json({ ...launched, dashboard: await getLiveSeratoDashboardMerged() });
  } catch (error) {
    console.error("POST /aura/music/serato/launch error:", error);
    res.status(500).json({ ok: false, error: "Could not launch Serato DJ Pro" });
  }
});

/** AURA MUSIC Sampling workspace — real IFCDC Music Library assets (no demo content). */
router.get("/aura/music/sampling", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getAuraMusicSamplingWorkspaceForHq } = await import("../hq/auraMusicSampling");
    res.json(await getAuraMusicSamplingWorkspaceForHq());
  } catch (error) {
    console.error("GET /aura/music/sampling error:", error);
    res.status(500).json({ ok: false, error: "Sampling workspace unavailable" });
  }
});

/** Build 61 — AURA Executive Intelligence Command Center */
router.get("/aura/ei/dashboard", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { buildEiDashboard } = await import("../hq/auraExecutiveIntelligenceFoundation");
    res.json(await buildEiDashboard());
  } catch (error) {
    console.error("GET /aura/ei/dashboard error:", error);
    res.status(500).json({ error: "Executive Intelligence dashboard unavailable" });
  }
});

router.get("/aura/ei/recommendations", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { buildEiRecommendations } = await import("../hq/auraExecutiveIntelligenceFoundation");
    res.json({ recommendations: await buildEiRecommendations(), generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("GET /aura/ei/recommendations error:", error);
    res.status(500).json({ error: "Executive recommendations unavailable" });
  }
});

router.get("/aura/ei/health/:pillar", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { explainHealthPillar } = await import("../hq/auraExecutiveIntelligenceFoundation");
    res.json(await explainHealthPillar(String(req.params.pillar ?? "organization")));
  } catch (error) {
    console.error("GET /aura/ei/health/:pillar error:", error);
    res.status(500).json({ error: "Health pillar explainer unavailable" });
  }
});

router.get("/aura/ei/briefings/:type", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { BRIEFING_TYPES, buildEiBriefing } = await import("../hq/auraExecutiveIntelligenceFoundation");
    const type = String(req.params.type ?? "morning");
    if (!(BRIEFING_TYPES as readonly string[]).includes(type)) {
      return res.status(400).json({ error: `Invalid briefing type. Use: ${BRIEFING_TYPES.join(", ")}` });
    }
    res.json(await buildEiBriefing(type as (typeof BRIEFING_TYPES)[number]));
  } catch (error) {
    console.error("GET /aura/ei/briefings error:", error);
    res.status(500).json({ error: "Executive briefing unavailable" });
  }
});

router.get("/aura/ei/predictions", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { buildEiPredictions } = await import("../hq/auraExecutiveIntelligenceFoundation");
    res.json(await buildEiPredictions());
  } catch (error) {
    console.error("GET /aura/ei/predictions error:", error);
    res.status(500).json({ error: "Predictive analytics unavailable" });
  }
});

router.post("/aura/ei/ask", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const question = String(req.body?.question ?? "").trim();
    if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
    const { askExecutiveIntelligence } = await import("../hq/auraExecutiveIntelligenceFoundation");
    res.json(await askExecutiveIntelligence(question));
  } catch (error) {
    console.error("POST /aura/ei/ask error:", error);
    res.status(500).json({ error: "Executive Intelligence chat unavailable" });
  }
});

/** Founder Technical Command — live ops briefing (Founder Mode required). */
router.get("/aura/technical/briefing", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { buildTechnicalCommandBriefing, logTechAudit } = await import("../hq/auraTechnicalCommandEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Technical Command Mode requires Founder access." });
  }
  const briefing = await buildTechnicalCommandBriefing();
  await logTechAudit({
    action: "briefing_api",
    resultStatus: "ok",
    detail: `score=${briefing.overallScore}`,
    actorEmail: identity.email || req.hqUser?.email,
    channel: "hq_web",
    metadata: { overallLabel: briefing.overallLabel, liveCommit: briefing.liveCommit },
  });
  res.json({ briefing, identity: publicIdentitySummary(identity) });
});

router.post("/aura/technical/command", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { handleTechnicalCommand } = await import("../hq/auraTechnicalCommandEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const founderMode = Boolean(identity.founderMode || identity.isFounder);
  const command = String(req.body?.command ?? "").trim();
  if (command.length < 3) return res.status(400).json({ error: "command must be at least 3 characters" });
  const result = await handleTechnicalCommand({
    command,
    channel: "hq_web",
    actorEmail: identity.email || req.hqUser?.email,
    founderMode,
    founderApproved: Boolean(req.body?.founderApproved),
  });
  res.status(result.blocked ? 403 : 200).json({
    ...result,
    identity: publicIdentitySummary(identity),
  });
});

router.get("/aura/technical/tickets", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { listOpenTechRepairTickets } = await import("../hq/auraTechnicalCommandEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Technical Command Mode requires Founder access." });
  }
  res.json({ tickets: await listOpenTechRepairTickets(25) });
});

/** AURA Intelligence System — metrics, decision support, org memory, proactive scan. */
router.get("/aura/intelligence/metrics", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildAuraIntelligenceMetrics } = await import("../hq/auraIntelligenceMetrics");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Intelligence metrics require Founder access." });
  }
  res.json(await buildAuraIntelligenceMetrics());
});

router.post("/aura/intelligence/decision-support", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { answerDecisionSupportQuestion } = await import("../hq/auraDecisionSupport");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Decision Support requires Founder Mode." });
  }
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  res.json(await answerDecisionSupportQuestion(question));
});

router.post("/aura/intelligence/memory", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { retrieveOrganizationalMemory } = await import("../hq/auraOrganizationalMemory");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Organizational Memory requires Founder Mode." });
  }
  const query = String(req.body?.query ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "query required" });
  res.json(await retrieveOrganizationalMemory(query));
});

router.post("/aura/intelligence/proactive-scan", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { evaluateAndEmitProactiveAlerts } = await import("../hq/auraProactiveIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Proactive scan requires Founder access." });
  }
  res.json(
    await evaluateAndEmitProactiveAlerts({
      notifyFounderChannels: Boolean(req.body?.notifyFounderChannels),
    })
  );
});

/** Multi-Agent Executive Team — Founder speaks only to AURA; specialists collaborate. */
router.get("/aura/agents", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { listExecutiveAgents } = await import("../hq/auraExecutiveAgentOrchestrator");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Executive Agent Team requires Founder access." });
  }
  res.json({ agents: listExecutiveAgents() });
});

router.post("/aura/agents/orchestrate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runEnterpriseBrain } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const request = String(req.body?.request ?? req.body?.command ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runEnterpriseBrain({
    request,
    channel: "hq_web",
    actorEmail: identity.email || req.hqUser?.email,
    founderMode: Boolean(identity.founderMode || identity.isFounder),
  });
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

/** AURA Enterprise Brain v1 — Executive Command Center (Founder-only, read-only). */
router.get("/aura/brain-v1/command-center", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildExecutiveCommandCenterV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const payload = await buildExecutiveCommandCenterV1({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
  });
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.command_center.read",
    result: `ok attention=${payload.summary.attentionCount} actionSystems=${payload.summary.actionSystemCount} degraded=${payload.degraded}`,
    metadata: { module: "executive-command-center", mode: "read_only" },
  });
  res.json(payload);
});

/** AURA Enterprise Brain v1 — Organization Health Dashboard (Founder-only, read-only). */
router.get("/aura/brain-v1/org-health", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildOrganizationHealthDashboardV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const payload = await buildOrganizationHealthDashboardV1();
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.org_health.read",
    result: `ok overall=${payload.overall} grade=${payload.grade} degraded=${payload.degraded}`,
    metadata: { module: "organization-health", mode: "read_only" },
  });
  res.json(payload);
});

/** AURA Enterprise Brain v1 — Executive Daily Briefing (Founder-only, read-only). */
router.get("/aura/brain-v1/daily-briefing", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildExecutiveDailyBriefingV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const payload = await buildExecutiveDailyBriefingV1();
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.daily_briefing.read",
    result: `ok source=${payload.source} highlights=${payload.highlights.length} degraded=${payload.degraded}`,
    metadata: { module: "daily-briefing", mode: "read_only", cached: payload.cached },
  });
  res.json(payload);
});

/** AURA Enterprise Brain v1 — Project Status Monitor (Founder-only, read-only). */
router.get("/aura/brain-v1/projects", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildProjectStatusMonitorV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const payload = await buildProjectStatusMonitorV1();
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.projects.read",
    result: `ok total=${payload.summary.total} pending=${payload.summary.pending} unhealthy=${payload.summary.unhealthy}`,
    metadata: { module: "project-status", mode: "read_only" },
  });
  res.json(payload);
});

/** AURA Enterprise Brain v1 — System Health Monitor (Founder-only, read-only). */
router.get("/aura/brain-v1/system-health", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildSystemHealthMonitorV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const payload = await buildSystemHealthMonitorV1();
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.system_health.read",
    result: `ok status=${payload.overallStatus} score=${payload.overallScore} alerts=${payload.alerts.length} degraded=${payload.degraded}`,
    metadata: { module: "system-health", mode: "read_only" },
  });
  res.json(payload);
});

/** AURA Enterprise Brain v1 — Executive Priority Queue (Founder-only, read-only). */
router.get("/aura/brain-v1/priority-queue", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildExecutivePriorityQueueV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const payload = await buildExecutivePriorityQueueV1({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
  });
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.priority_queue.read",
    result: `ok total=${payload.summary.total} critical=${payload.summary.critical} high=${payload.summary.high}`,
    metadata: { module: "priority-queue", mode: "read_only" },
  });
  res.json(payload);
});

/** AURA Enterprise Brain v1 — Executive Action Center catalog (Founder-only). */
router.get("/aura/brain-v1/actions", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildExecutiveActionCenterV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const payload = await buildExecutiveActionCenterV1();
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.actions.read",
    result: `ok actions=${payload.actions.length}`,
    metadata: { module: "action-center", mode: "read_only" },
  });
  res.json(payload);
});

/** Confirm-gated Brain v1 action execution (no production mutations enabled yet). */
router.post("/aura/brain-v1/actions/execute", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { executeBrainV1ConfirmedAction } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const actionId = String(req.body?.actionId ?? "").trim();
  const confirmed = Boolean(req.body?.confirmed);
  if (!actionId) return res.status(400).json({ error: "actionId required" });
  const result = await executeBrainV1ConfirmedAction({
    actionId,
    confirmed,
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

/** AURA Enterprise Brain v1 — Secure AURA Action Log (Founder-only, read-only). */
router.get("/aura/brain-v1/action-log", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const {
    buildSecureAuraActionLogV1,
    logAuraBrainV1Action,
  } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Enterprise Brain v1 requires Founder access." });
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const payload = await buildSecureAuraActionLogV1(limit);
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "brain_v1.action_log.read",
    result: `ok returned=${payload.summary.totalReturned}`,
    metadata: { module: "action-log", mode: "read_only", limit },
  });
  res.json(payload);
});

/** AURA E2E Diagnostics — Phase 1 connection matrix (Founder-only, read-only; Twilio config untouched). */
router.get("/aura/diagnostics/e2e", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildAuraE2eDiagnostics } = await import("../hq/auraE2eDiagnosticsEngine");
  const { logAuraBrainV1Action } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA E2E diagnostics requires Founder access." });
  }
  const payload = await buildAuraE2eDiagnostics({
    founderMode: identity.founderMode,
    isFounder: identity.isFounder,
    email: identity.email,
    assurance: identity.assurance,
  });
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "aura.diagnostics.e2e.read",
    result: `ok connected=${payload.summary.connected} partial=${payload.summary.partial} missing=${payload.summary.missing}`,
    metadata: { module: "e2e-diagnostics", mode: "read_only", twilioConfigUntouched: true },
  });
  res.json(payload);
});

/** AURA Unified Action Audit — Phase 2 stream (Founder-only, read-only). */
router.get("/aura/diagnostics/unified-audit", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildAuraUnifiedAuditReport } = await import("../hq/auraUnifiedAudit");
  const { logAuraBrainV1Action } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA unified audit requires Founder access." });
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const payload = await buildAuraUnifiedAuditReport(limit);
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "aura.diagnostics.unified_audit.read",
    result: `ok returned=${payload.summary.totalReturned} failed=${payload.summary.failed}`,
    metadata: { module: "unified-audit", mode: "read_only", limit },
  });
  res.json(payload);
});

/** AURA Operational Events — Phase 5 bus (Founder-only, read-only). */
router.get("/aura/diagnostics/operational-events", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildAuraOperationalEventsReport } = await import("../hq/auraOperationalEvents");
  const { logAuraBrainV1Action } = await import("../hq/auraEnterpriseBrainV1");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA operational events require Founder access." });
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const payload = await buildAuraOperationalEventsReport(limit);
  await logAuraBrainV1Action({
    userId: identity.userId || req.hqUser?.id,
    userEmail: identity.email || req.hqUser?.email,
    command: "aura.diagnostics.operational_events.read",
    result: `ok returned=${payload.summary.totalReturned} high=${payload.summary.highSeverity}`,
    metadata: { module: "operational-events", mode: "read_only", limit },
  });
  res.json(payload);
});

/** Phase 7 — legacy :4101 access log (Founder-only). */
router.get("/aura/diagnostics/legacy-4101", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { getLegacy4101Summary, listLegacy4101Access } = await import("../hq/auraLegacy4101");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Legacy :4101 diagnostics require Founder access." });
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  res.json({
    summary: getLegacy4101Summary(),
    entries: listLegacy4101Access(limit),
    twilioConfigUntouched: true,
    phase7: true,
  });
});

/** AURA Enterprise Brain 2.0 */
router.post("/aura/brain", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runEnterpriseBrain } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const request = String(req.body?.request ?? req.body?.command ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runEnterpriseBrain({
    request,
    channel: "hq_web",
    actorEmail: identity.email || req.hqUser?.email,
    founderMode: Boolean(identity.founderMode || identity.isFounder),
  });
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

router.get("/aura/brain/org-model", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildDigitalOrganizationModel } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain requires Founder access." });
  }
  res.json(await buildDigitalOrganizationModel());
});

router.get("/aura/brain/daily-briefing", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildEnterpriseBrainDailyBriefing } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain requires Founder access." });
  }
  res.json(await buildEnterpriseBrainDailyBriefing());
});

router.get("/aura/brain/predictions", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildPredictiveIntelligenceSignals } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain requires Founder access." });
  }
  res.json({ predictions: await buildPredictiveIntelligenceSignals() });
});

router.post("/aura/brain/feedback", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { recordFounderBrainFeedback } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain feedback requires Founder access." });
  }
  const feedbackType = String(req.body?.feedbackType ?? "").trim();
  if (!feedbackType) return res.status(400).json({ error: "feedbackType required" });
  res.json(
    await recordFounderBrainFeedback({
      brainRunId: typeof req.body?.brainRunId === "string" ? req.body.brainRunId : undefined,
      feedbackType: feedbackType as "approved" | "rejected" | "correction" | "useful" | "not_useful",
      rating: typeof req.body?.rating === "number" ? req.body.rating : undefined,
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
      decisionRef: typeof req.body?.decisionRef === "string" ? req.body.decisionRef : undefined,
      actorEmail: identity.email || req.hqUser?.email,
    })
  );
});

/** Phase 3 — Executive Decision Intelligence */
router.post("/aura/edi/decide", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runExecutiveDecisionIntelligence } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const request = String(req.body?.request ?? req.body?.question ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runExecutiveDecisionIntelligence({
    request,
    channel: "hq_web",
    founderMode: Boolean(identity.founderMode || identity.isFounder),
  });
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

router.get("/aura/edi/dashboard", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildEnterpriseBrainDashboard } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Executive Decision Intelligence requires Founder access." });
  }
  res.json(await buildEnterpriseBrainDashboard());
});

router.get("/aura/edi/scorecard", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildOrganizationPerformanceScorecard } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Scorecard requires Founder access." });
  }
  res.json(await buildOrganizationPerformanceScorecard());
});

router.get("/aura/edi/goals", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { listStrategicGoals } = await import("../hq/strategicGoalsEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Strategic Goals Center requires Founder access." });
  }
  res.json(await listStrategicGoals());
});

router.post("/aura/edi/goals", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { upsertStrategicGoal } = await import("../hq/strategicGoalsEngine");
  type GoalCat = import("../hq/strategicGoalsEngine").StrategicGoalCategory;
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Updating strategic goals requires Founder access." });
  }
  const title = String(req.body?.title ?? "").trim();
  const category = String(req.body?.category ?? "").trim() as GoalCat;
  if (!title || !category) return res.status(400).json({ error: "title and category required" });
  res.json(
    await upsertStrategicGoal({
      id: typeof req.body?.id === "string" ? req.body.id : undefined,
      category,
      title,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      targetValue: typeof req.body?.targetValue === "number" ? req.body.targetValue : undefined,
      unit: typeof req.body?.unit === "string" ? req.body.unit : undefined,
      owner: typeof req.body?.owner === "string" ? req.body.owner : undefined,
      department: typeof req.body?.department === "string" ? req.body.department : undefined,
      targetDate: typeof req.body?.targetDate === "string" ? req.body.targetDate : undefined,
      actorEmail: identity.email || req.hqUser?.email,
    })
  );
});

router.get("/aura/edi/opportunities", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildOpportunityIntelligence } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Opportunity Intelligence requires Founder access." });
  }
  res.json({ opportunities: await buildOpportunityIntelligence() });
});

router.get("/aura/edi/weekly-review", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildWeeklyExecutiveReview } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Weekly Executive Review requires Founder access." });
  }
  res.json(await buildWeeklyExecutiveReview());
});

router.post("/aura/edi/simulate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runExecutiveDecisionEngine } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Simulations require Founder access." });
  }
  const request = String(req.body?.request ?? req.body?.question ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runExecutiveDecisionEngine(
    /\bwhat (happens|if)\b/i.test(request) ? request : `What happens if ${request}`
  );
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

/** AURA Enterprise OS 4.0 */
router.get("/aura/os/mission-control", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildEnterpriseOsMissionControl } = await import("../hq/auraEnterpriseOs4");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise OS Mission Control requires Founder access." });
  }
  res.json(await buildEnterpriseOsMissionControl());
});

router.post("/aura/os/run", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runEnterpriseOs } = await import("../hq/auraEnterpriseOs4");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const request = String(req.body?.request ?? req.body?.command ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runEnterpriseOs({
    request,
    channel: "hq_web",
    founderMode: Boolean(identity.founderMode || identity.isFounder),
    actorEmail: identity.email || req.hqUser?.email,
  });
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

router.get("/aura/os/workflows", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { runAutonomousWorkflowScan } = await import("../hq/auraEnterpriseOs4");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Autonomous workflows require Founder access." });
  }
  res.json({ actions: await runAutonomousWorkflowScan() });
});

router.get("/aura/os/knowledge-graph", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildExecutiveKnowledgeGraph } = await import("../hq/auraEnterpriseOs4");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Knowledge graph requires Founder access." });
  }
  res.json(await buildExecutiveKnowledgeGraph());
});

router.post("/aura/os/search", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { runEnterpriseOsSearch } = await import("../hq/auraEnterpriseOs4");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise search requires Founder access." });
  }
  const question = String(req.body?.question ?? req.body?.request ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  res.json(await runEnterpriseOsSearch(question));
});

router.post("/aura/os/orchestrate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { orchestrateGrantOpportunityWorkflow } = await import("../hq/auraEnterpriseOs4");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Orchestration requires Founder access." });
  }
  res.json(
    await orchestrateGrantOpportunityWorkflow({
      opportunityTitle: typeof req.body?.opportunityTitle === "string" ? req.body.opportunityTitle : undefined,
      request: typeof req.body?.request === "string" ? req.body.request : undefined,
    })
  );
});

router.post("/aura/os/automate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildExecutiveAutomationPackage } = await import("../hq/auraEnterpriseOs4");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Executive automation requires Founder access." });
  }
  const kind = String(req.body?.kind ?? "weekly_executive").trim() as
    | "weekly_executive"
    | "monthly_board"
    | "compliance_calendar"
    | "grant_status"
    | "financial_summary"
    | "technology_report";
  res.json(await buildExecutiveAutomationPackage(kind));
});

router.post("/aura/executive/action-plan", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await generateExecutiveActionPlan());
});

router.post("/aura/navigate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "query must be at least 2 characters" });
  const { auraNavigate } = await import("../hq/auraNlNavigation");
  res.json(await auraNavigate(query));
});

// AURA native command layer — free-form command dispatch across all of HQ.
router.post("/aura/command", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const command = String(req.body?.command ?? "").trim();
    if (command.length < 2) return res.status(400).json({ error: "command must be at least 2 characters" });
    const module = typeof req.body?.module === "string" ? req.body.module : undefined;
    const contextRef =
      req.body?.contextRef && typeof req.body.contextRef === "object" ? req.body.contextRef : undefined;
    const deviceId =
      typeof req.body?.deviceId === "string"
        ? req.body.deviceId
        : typeof req.headers["x-aura-device-id"] === "string"
          ? req.headers["x-aura-device-id"]
          : null;
    const {
      resolveIdentityFromHqUser,
      resolveTrustedFounderDevice,
      logAuraIdentityAction,
    } = await import("../hq/auraFounderTrustEngine");
    const device = await resolveTrustedFounderDevice({
      deviceId,
      email: req.hqUser?.email ?? null,
    });
    const identity = resolveIdentityFromHqUser({
      user: req.hqUser,
      channel: "hq_web",
      sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
      trustedDeviceId: device.deviceId,
      deviceTrusted: device.trusted,
    });
    const { runAuraCommand } = await import("../hq/auraCommandLayer");
    const result = await runAuraCommand({
      command,
      module,
      contextRef,
      actorEmail: req.hqUser?.email ?? identity.email ?? "unknown",
      actorUser: req.hqUser,
      identity,
    });
    if (identity.founderMode) {
      void logAuraIdentityAction({
        identity,
        action: "aura_founder_command",
        detail: command.slice(0, 240),
        metadata: { module, seamless: device.trusted },
        ipAddress: req.ip,
      });
    }
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AURA command failed";
    console.error("AURA command error:", message);
    res.status(/401|api key/i.test(message) ? 400 : 500).json({ error: message });
  }
});

// Directly invoke a registered AURA action (contextual UI buttons).
router.post("/aura/action/:actionId", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const actionId = String(req.params.actionId);
    const args = req.body?.args && typeof req.body.args === "object" ? req.body.args : {};
    const module = typeof req.body?.module === "string" ? req.body.module : undefined;
    const contextRef =
      req.body?.contextRef && typeof req.body.contextRef === "object" ? req.body.contextRef : undefined;
    const deviceId =
      typeof req.body?.deviceId === "string"
        ? req.body.deviceId
        : typeof req.headers["x-aura-device-id"] === "string"
          ? req.headers["x-aura-device-id"]
          : null;
    const { resolveIdentityFromHqUser, resolveTrustedFounderDevice, logAuraIdentityAction } = await import(
      "../hq/auraFounderTrustEngine"
    );
    const device = await resolveTrustedFounderDevice({
      deviceId,
      email: req.hqUser?.email ?? null,
    });
    const identity = resolveIdentityFromHqUser({
      user: req.hqUser,
      channel: "hq_web",
      sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
      trustedDeviceId: device.deviceId,
      deviceTrusted: device.trusted,
    });
    const { runAuraAction } = await import("../hq/auraCommandLayer");
    const result = await runAuraAction(actionId, args, {
      actorEmail: req.hqUser?.email ?? identity.email ?? "unknown",
      module,
      contextRef,
      identity,
    });
    if (identity.founderMode) {
      void logAuraIdentityAction({
        identity,
        action: "aura_founder_action",
        detail: actionId,
        metadata: { module, seamless: device.trusted },
        ipAddress: req.ip,
      });
    }
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AURA action failed";
    console.error("AURA action error:", message);
    res.status(/401|api key/i.test(message) ? 400 : 500).json({ error: message });
  }
});

/** Founder Identity & Trust — current AURA identity for this HQ session. */
router.get("/aura/identity", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const {
    resolveIdentityFromHqUser,
    publicIdentitySummary,
    ensureAuraTrustTables,
    resolveTrustedFounderDevice,
  } = await import("../hq/auraFounderTrustEngine");
  await ensureAuraTrustTables();
  const deviceId =
    typeof req.query.deviceId === "string"
      ? req.query.deviceId
      : typeof req.headers["x-aura-device-id"] === "string"
        ? req.headers["x-aura-device-id"]
        : null;
  const device = await resolveTrustedFounderDevice({
    deviceId,
    email: req.hqUser?.email ?? null,
  });
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
    trustedDeviceId: device.deviceId,
    deviceTrusted: device.trusted,
  });
  res.json({
    identity: publicIdentitySummary(identity),
    device: {
      trusted: device.trusted,
      biometricBound: device.biometricBound,
      expiresAt: device.expiresAt,
    },
  });
});

/** Register this browser as a Founder trusted device (Face ID / Touch ID gate on client). */
router.post("/aura/identity/trust-device", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const {
    resolveIdentityFromHqUser,
    registerTrustedFounderDevice,
    publicIdentitySummary,
  } = await import("../hq/auraFounderTrustEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.isFounder) {
    return res.status(403).json({ error: "Only the Founder can register a trusted device." });
  }
  const deviceId = String(req.body?.deviceId ?? "").trim();
  const result = await registerTrustedFounderDevice({
    email: identity.email || "",
    userId: identity.userId,
    displayName: identity.displayName,
    deviceId,
    label: typeof req.body?.label === "string" ? req.body.label : "Founder HQ browser",
    biometricBound: Boolean(req.body?.biometricBound),
    publicKeyJwk: typeof req.body?.publicKeyJwk === "string" ? req.body.publicKeyJwk : null,
  });
  if (!result.ok) return res.status(400).json(result);
  const elevated = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
    trustedDeviceId: result.deviceId,
    deviceTrusted: true,
  });
  res.json({ ...result, identity: publicIdentitySummary(elevated) });
});

/** Founder OTP delivery audit — recent channel attempts with provider responses. */
router.get("/aura/founder-verification/logs", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getRecentOtpDeliveryLogs } = await import("../hq/auraFounderOtpDelivery");
  const { getEmailDeliveryStatus, probeResendSender } = await import("../lib/notifications");
  const { getTwilioEnvStatus } = await import("../hq/twilioIntegrationEngine");
  const limit = Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 100);
  const [logs, resendProbe] = await Promise.all([
    getRecentOtpDeliveryLogs(limit),
    probeResendSender().catch(() => null),
  ]);
  res.json({
    logs,
    email: getEmailDeliveryStatus(),
    resendProbe,
    twilio: getTwilioEnvStatus(),
    timestamp: new Date().toISOString(),
  });
});

/** Production probe — sends real test Founder OTP email/SMS and returns provider responses. */
router.post("/aura/founder-verification/probe", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { probeFounderVerificationDelivery } = await import("../hq/auraFounderOtpDelivery");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.isFounder) {
    return res.status(403).json({ error: "Founder access required for verification probe." });
  }
  const smsTo = typeof req.body?.smsTo === "string" ? req.body.smsTo.trim() : null;
  const result = await probeFounderVerificationDelivery({ smsTo });
  res.json({
    ...result,
    note: "Test code 000000 was used — discard any test messages. Check providerResponse for failure details.",
  });
});

router.delete("/aura/identity/trust-device", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { revokeTrustedFounderDevice, resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const identity = resolveIdentityFromHqUser({ user: req.hqUser, channel: "hq_web" });
  if (!identity.isFounder) return res.status(403).json({ error: "Forbidden" });
  const deviceId =
    typeof req.body?.deviceId === "string"
      ? req.body.deviceId
      : typeof req.query.deviceId === "string"
        ? req.query.deviceId
        : "";
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });
  res.json(await revokeTrustedFounderDevice(deviceId, identity.email || ""));
});

// Catalog of AURA actions for rendering buttons.
router.get("/aura/actions", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  const { listAuraActions } = await import("../hq/auraCommandLayer");
  res.json({ actions: listAuraActions() });
});

// AURA conversation memory.
router.get("/aura/memory", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getRecentAuraTurns } = await import("../hq/auraMemory");
  const turns = await getRecentAuraTurns(req.hqUser?.email ?? "founder", 20);
  res.json({ turns });
});

router.post("/aura/memory/reset", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resetAuraMemory } = await import("../hq/auraMemory");
  res.json(await resetAuraMemory(req.hqUser?.email ?? "founder"));
});

// ---------------------------------------------------------------------------
// AURA Organizational Knowledge Base — institutional memory for grant writing.
// ---------------------------------------------------------------------------
router.get("/knowledge/status", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getKnowledgeBaseStatus } = await import("../hq/knowledgeBaseEngine");
    res.json(await getKnowledgeBaseStatus());
  } catch (err) {
    console.error("[knowledge] status error:", err);
    res.status(500).json({ error: "Knowledge base status unavailable" });
  }
});

router.get("/knowledge/documents", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { listKnowledgeDocuments } = await import("../hq/knowledgeBaseEngine");
    const documents = await listKnowledgeDocuments({
      sourceType: req.query.source_type ? String(req.query.source_type) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    res.json({ documents });
  } catch (err) {
    console.error("[knowledge] list error:", err);
    res.json({ documents: [], degraded: true });
  }
});

router.get("/knowledge/documents/:id", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
  const document = await getKnowledgeDocument(String(req.params.id));
  if (!document) return res.status(404).json({ error: "Knowledge document not found" });
  res.json({ document });
});

router.post("/knowledge/search", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const query = String(req.body?.query ?? req.body?.q ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "query must be at least 2 characters" });
  const { retrieveKnowledge } = await import("../hq/knowledgeBaseEngine");
  const results = await retrieveKnowledge(query, { topK: Number(req.body?.topK) || 8 });
  res.json({ query, results });
});

router.post("/knowledge/sync", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { syncKnowledgeBaseFromHq } = await import("../hq/knowledgeBaseEngine");
    const result = await syncKnowledgeBaseFromHq({
      embed: req.body?.embed !== false,
      actorEmail: req.hqUser?.email,
    });
    res.json(result);
  } catch (err) {
    console.error("[knowledge] sync error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Knowledge base sync failed" });
  }
});

router.post("/knowledge/documents", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { sourceType, title, content, summary, effectiveDate, sourceKey } = req.body ?? {};
  if (!title || !content) return res.status(400).json({ error: "title and content are required" });
  try {
    const { ingestKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
    const result = await ingestKnowledgeDocument({
      sourceType: sourceType || "document",
      sourceKey: sourceKey || undefined,
      title: String(title),
      content: String(content),
      summary: summary ? String(summary) : undefined,
      effectiveDate: effectiveDate ? String(effectiveDate) : undefined,
      origin: "manual",
      createdBy: req.hqUser?.email,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("[knowledge] manual ingest error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to ingest knowledge" });
  }
});

router.post("/knowledge/documents/:id/approve", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { approveKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
  const document = await approveKnowledgeDocument(String(req.params.id), req.hqUser?.email);
  if (!document) return res.status(404).json({ error: "Knowledge document not found" });
  res.json({ document });
});

router.post("/knowledge/documents/:id/supersede", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { supersedeKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
  const document = await supersedeKnowledgeDocument(String(req.params.id), req.hqUser?.email);
  res.json({ document });
});

router.post("/notifications/broadcast", hqAuthRequired, requireHQModule("notifications"), async (req, res) => {
  const { to, subject, body, channel } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "to, subject, and body are required" });
  }
  const result = await sendHqNotification({
    to,
    subject,
    body,
    channel: channel || "email",
  });
  res.json(result);
});

router.get("/roles", hqAuthRequired, (_req, res) => {
  res.json({
    hqRoles: HQ_MODULE_PERMISSIONS,
    userRole: _req.hqUser?.role,
    hqRole: _req.hqUser ? toHQRole(_req.hqUser.role) : null,
  });
});

export default router;
