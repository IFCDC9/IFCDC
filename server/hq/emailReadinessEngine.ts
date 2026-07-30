/**
 * Executive Email Readiness — read-only inventory + optional Founder-inbox matrix runner.
 * Does not change auth/booking/grant product behavior; additive audit surface only.
 */
import { listEmailTemplates, renderEmailTemplate, type EmailTemplateId } from "./emailTemplates";
import {
  getEmailDeliveryStatus,
  probeResendSender,
  resolveResendFromEmail,
  resolveVerifiedResendFromEmail,
} from "../lib/notifications";
import { sendBrandedEmail } from "./emailEngine";

export type WorkflowStatus = "connected" | "partial" | "template_only" | "not_configured";

export type EmailWorkflowDef = {
  id: string;
  name: string;
  category: string;
  routeOrService: string;
  templateId: string | null;
  senderExpected: string;
  recipientLogic: string;
  status: WorkflowStatus;
  notes: string;
  securityNotes?: string;
};

export type EmailWorkflowTestResult = {
  workflowId: string;
  name: string;
  result: "PASS" | "FAIL" | "NOT_CONFIGURED" | "SKIPPED";
  warnings: string[];
  route: string;
  sender: string | null;
  recipient: string | null;
  template: string | null;
  httpStatus: number | null;
  resendAccepted: boolean | null;
  messageId: string | null;
  deliveryStatus: "accepted" | "delivered" | "bounced" | "deferred" | "failed" | "not_configured" | "unknown";
  securityObservations: string[];
  testedAt: string;
  error?: string;
};

const SENDER = "IFCDC Headquarters <service@ifcdc.org>";

/** Static inventory — keep in sync with codebase audit (Phase 1). */
export function listEmailWorkflows(): EmailWorkflowDef[] {
  return [
    {
      id: "registration_welcome",
      name: "New user registration email",
      category: "auth",
      routeOrService: "POST /api/auth/register (+ sendWelcomeEmail helper unused)",
      templateId: "welcome",
      senderExpected: SENDER,
      recipientLogic: "New registrant email",
      status: "template_only",
      notes: "Register creates user; sendWelcomeEmail is not called from auth routes.",
      securityNotes: "Wiring welcome mail must not leak password; use magic link or login CTA only.",
    },
    {
      id: "email_verification",
      name: "Email verification",
      category: "auth",
      routeOrService: "(none)",
      templateId: null,
      senderExpected: SENDER,
      recipientLogic: "n/a",
      status: "not_configured",
      notes: "No email verification flow found in HQ.",
    },
    {
      id: "forgot_password",
      name: "Forgot-password email",
      category: "auth",
      routeOrService: "sendPasswordResetEmail helper (no HQ route caller)",
      templateId: "password_reset",
      senderExpected: SENDER,
      recipientLogic: "Account email",
      status: "template_only",
      notes: "Template + helper exist; no forgot-password route wired to Resend.",
      securityNotes: "Reset tokens must be single-use, short TTL, never logged.",
    },
    {
      id: "password_reset_confirm",
      name: "Password-reset confirmation",
      category: "auth",
      routeOrService: "(none)",
      templateId: null,
      senderExpected: SENDER,
      recipientLogic: "n/a",
      status: "not_configured",
      notes: "No post-reset confirmation email found.",
    },
    {
      id: "founder_otp_security",
      name: "Login/security notification (Founder OTP)",
      category: "security",
      routeOrService: "auraFounderOtpDelivery → sendFounderSecurityEmail",
      templateId: "executive_alert",
      senderExpected: SENDER,
      recipientLogic: "MASTER_OWNER_EMAIL / service@ifcdc.org",
      status: "connected",
      notes: "Founder OTP / security path is live on Resend.",
      securityNotes: "OTP codes are sensitive; never echo in client responses.",
    },
    {
      id: "admin_notifications",
      name: "Admin notification emails",
      category: "admin",
      routeOrService: "AURA proactive / executive ops / HQ notification helpers",
      templateId: "executive_alert",
      senderExpected: SENDER,
      recipientLogic: "Founder / configured executive recipients",
      status: "partial",
      notes: "Some AURA/admin paths send; no universal admin signup mail.",
    },
    {
      id: "contact_support",
      name: "Contact/support form emails",
      category: "communications",
      routeOrService: "sendContactFormEmail helper",
      templateId: "contact_form",
      senderExpected: SENDER,
      recipientLogic: "HQ support / service@ifcdc.org",
      status: "template_only",
      notes: "Helper exists; public contact → Resend wiring not found.",
    },
    {
      id: "booking_confirmation",
      name: "Booking confirmation emails",
      category: "bookings",
      routeOrService: "HQ sendBookingConfirmationEmail; Barbers app separate",
      templateId: "booking_confirmation",
      senderExpected: SENDER,
      recipientLogic: "Customer (+ barber on Barbers product)",
      status: "partial",
      notes: "HQ template unused by HQ booking routes. Barbers production confirms separately.",
    },
    {
      id: "booking_cancellation",
      name: "Booking cancellation emails",
      category: "bookings",
      routeOrService: "(none in HQ)",
      templateId: null,
      senderExpected: SENDER,
      recipientLogic: "n/a",
      status: "not_configured",
      notes: "No HQ cancellation email path found.",
    },
    {
      id: "booking_reschedule",
      name: "Booking reschedule emails",
      category: "bookings",
      routeOrService: "(none in HQ)",
      templateId: null,
      senderExpected: SENDER,
      recipientLogic: "n/a",
      status: "not_configured",
      notes: "No HQ reschedule email path found.",
    },
    {
      id: "grant_notifications",
      name: "Grant-related notifications",
      category: "grants",
      routeOrService: "grantIntelligenceEngine → sendGrantNotificationEmail / sendApprovalEmail",
      templateId: "grant_notification",
      senderExpected: SENDER,
      recipientLogic: "Grant actors / Founder as configured by engine",
      status: "partial",
      notes: "Email helpers called from intelligence paths; many grant notices are in-app only.",
    },
    {
      id: "hr_hiring",
      name: "HR and hiring notifications",
      category: "people",
      routeOrService: "people / job applicant engines (DB only)",
      templateId: null,
      senderExpected: SENDER,
      recipientLogic: "n/a",
      status: "not_configured",
      notes: "Hiring flows persist applicants; no Resend send found.",
    },
    {
      id: "system_alerts",
      name: "System alerts",
      category: "ops",
      routeOrService: "criticalAlerts.ts (in-app HQ notifications)",
      templateId: "executive_alert",
      senderExpected: SENDER,
      recipientLogic: "HQ notification center",
      status: "partial",
      notes: "Alerts are in-app; not emailed via Resend.",
    },
    {
      id: "aura_generated",
      name: "AURA-generated emails",
      category: "aura",
      routeOrService: "sendAuraGeneratedEmail / live-send / test-branded / send-template",
      templateId: "aura_message",
      senderExpected: SENDER,
      recipientLogic: "Founder inbox / explicit to=",
      status: "connected",
      notes: "Production live-send proven with service@ifcdc.org.",
    },
    {
      id: "comms_broadcast",
      name: "Communications broadcast (segment)",
      category: "communications",
      routeOrService: "POST /api/hq/communications/broadcast-segment → sendHqNotification",
      templateId: "generic",
      senderExpected: SENDER,
      recipientLogic: "Active people segment (up to 500)",
      status: "connected",
      notes: "High-impact bulk path. Do not live-test without Founder approval.",
      securityNotes: "Require confirmation before bulk send; audit recipients.",
    },
    {
      id: "executive_documents",
      name: "Executive briefing / board report email",
      category: "executive",
      routeOrService: "executiveDocumentDelivery → sendHqNotification",
      templateId: "daily_report",
      senderExpected: SENDER,
      recipientLogic: "Founder / opts.to",
      status: "connected",
      notes: "Optional sendEmail flag on intelligence/phase9 delivery.",
    },
    {
      id: "appointment_reminder_hq",
      name: "Appointment reminder (HQ monolith)",
      category: "bookings",
      routeOrService: "appointmentReminders.ts",
      templateId: "appointment_reminder",
      senderExpected: SENDER,
      recipientLogic: "Client phone (SMS/voice)",
      status: "not_configured",
      notes: "Reminders are SMS/voice only — email template unused.",
    },
  ];
}

export function dryRenderAllTemplates(): Array<{
  templateId: string;
  ok: boolean;
  subject?: string;
  error?: string;
}> {
  const out: Array<{ templateId: string; ok: boolean; subject?: string; error?: string }> = [];
  for (const t of listEmailTemplates()) {
    try {
      const rendered = renderEmailTemplate(t.id as EmailTemplateId, {
        recipientName: "Fahreal Allah",
        message: "Email readiness dry-render probe.",
        fields: {
          email: "service@ifcdc.org",
          role: "Founder",
          service: "Executive briefing",
          when: new Date().toISOString(),
          location: "IFCDC HQ",
          reference: "READINESS",
          itemTitle: "Readiness item",
          grantTitle: "Sample grant",
          alertTitle: "Readiness alert",
          reportDate: new Date().toISOString().slice(0, 10),
        },
        cta: { label: "Open Headquarters", href: "https://ifcdc.org/login" },
      });
      out.push({ templateId: t.id, ok: Boolean(rendered.html && rendered.subject), subject: rendered.subject });
    } catch (err) {
      out.push({
        templateId: t.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

export async function buildEmailReadinessReport(opts?: {
  lastResults?: EmailWorkflowTestResult[];
}): Promise<{
  generatedAt: string;
  sender: {
    configured: string;
    effective: string | null;
    usedFallback: boolean | null;
    apiKeySet: boolean;
    probeOk: boolean | null;
    trustedSender: boolean | null;
  };
  summary: {
    totalWorkflows: number;
    connected: number;
    partial: number;
    templateOnly: number;
    notConfigured: number;
    tested: number;
    passed: number;
    failed: number;
    notConfiguredTests: number;
    warnings: number;
    productionReadinessPercent: number;
  };
  workflows: EmailWorkflowDef[];
  templateDryRender: ReturnType<typeof dryRenderAllTemplates>;
  lastResults: EmailWorkflowTestResult[];
  recommendations: string[];
}> {
  const workflows = listEmailWorkflows();
  const status = getEmailDeliveryStatus();
  let effective: string | null = null;
  let usedFallback: boolean | null = null;
  let probeOk: boolean | null = null;
  let trustedSender: boolean | null = null;
  try {
    const verified = await resolveVerifiedResendFromEmail();
    effective = verified.from;
    usedFallback = verified.usedFallback;
    probeOk = verified.probe.ok;
  } catch {
    effective = status.from;
  }
  try {
    const probe = await probeResendSender();
    probeOk = probe.ok;
  } catch {
    /* keep prior */
  }

  const lastResults = opts?.lastResults || [];
  const connected = workflows.filter((w) => w.status === "connected").length;
  const partial = workflows.filter((w) => w.status === "partial").length;
  const templateOnly = workflows.filter((w) => w.status === "template_only").length;
  const notConfigured = workflows.filter((w) => w.status === "not_configured").length;
  const tested = lastResults.length;
  const passed = lastResults.filter((r) => r.result === "PASS").length;
  const failed = lastResults.filter((r) => r.result === "FAIL").length;
  const notConfiguredTests = lastResults.filter((r) => r.result === "NOT_CONFIGURED").length;
  const warnings = lastResults.reduce((n, r) => n + r.warnings.length, 0);

  // Readiness: weight connected+partial that pass probes, and not_configured as gaps.
  const actionable = workflows.filter((w) => w.status === "connected" || w.status === "partial").length;
  const criticalGaps = notConfigured + templateOnly;
  const productionReadinessPercent = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        ((connected * 1 + partial * 0.5) / Math.max(1, workflows.length)) * 70
          + (status.apiKeySet && probeOk && !usedFallback ? 20 : status.apiKeySet ? 10 : 0)
          + (dryRenderAllTemplates().every((t) => t.ok) ? 10 : 0)
          - Math.min(20, criticalGaps),
      ),
    ),
  );

  const recommendations: string[] = [];
  if (usedFallback) {
    recommendations.push("Clear Resend fallback: ensure RESEND_FROM_EMAIL domain stays verified.");
  }
  if (templateOnly > 0) {
    recommendations.push(
      `Wire ${templateOnly} template-only workflow(s) (welcome, password reset, contact) only after Founder-approved product specs.`,
    );
  }
  if (notConfigured > 0) {
    recommendations.push(
      `Decide product scope for ${notConfigured} not-configured workflow(s) (email verification, booking cancel/reschedule, HR mail).`,
    );
  }
  recommendations.push("Never live-test communications broadcast-segment without explicit Founder approval.");
  recommendations.push("Keep Barbers booking/payment email on Barbers backend; do not duplicate silently in HQ.");

  return {
    generatedAt: new Date().toISOString(),
    sender: {
      configured: resolveResendFromEmail(),
      effective,
      usedFallback,
      apiKeySet: status.apiKeySet,
      probeOk,
      trustedSender,
    },
    summary: {
      totalWorkflows: workflows.length,
      connected,
      partial,
      templateOnly,
      notConfigured,
      tested,
      passed,
      failed,
      notConfiguredTests,
      warnings,
      productionReadinessPercent,
    },
    workflows,
    templateDryRender: dryRenderAllTemplates(),
    lastResults,
    recommendations,
  };
}

const MATRIX_TEMPLATES: Array<{ workflowId: string; templateId: EmailTemplateId; name: string }> = [
  { workflowId: "registration_welcome", templateId: "welcome", name: "Template matrix — welcome" },
  { workflowId: "forgot_password", templateId: "password_reset", name: "Template matrix — password_reset" },
  { workflowId: "booking_confirmation", templateId: "booking_confirmation", name: "Template matrix — booking_confirmation" },
  { workflowId: "appointment_reminder_hq", templateId: "appointment_reminder", name: "Template matrix — appointment_reminder" },
  { workflowId: "grant_notifications", templateId: "grant_notification", name: "Template matrix — grant_notification" },
  { workflowId: "grant_notifications", templateId: "approval_notification", name: "Template matrix — approval_notification" },
  { workflowId: "grant_notifications", templateId: "denial_notification", name: "Template matrix — denial_notification" },
  { workflowId: "contact_support", templateId: "contact_form", name: "Template matrix — contact_form" },
  { workflowId: "admin_notifications", templateId: "executive_alert", name: "Template matrix — executive_alert" },
  { workflowId: "executive_documents", templateId: "daily_report", name: "Template matrix — daily_report" },
  { workflowId: "aura_generated", templateId: "aura_message", name: "Template matrix — aura_message" },
  { workflowId: "comms_broadcast", templateId: "generic", name: "Template matrix — generic" },
];

/**
 * Founder-inbox only template matrix. Uses sendBrandedEmail (real Resend).
 * Recipient must be service@ifcdc.org / MASTER_OWNER_EMAIL.
 */
export async function runFounderInboxTemplateMatrix(to: string): Promise<EmailWorkflowTestResult[]> {
  const allowed =
    to === "service@ifcdc.org"
    || to === (process.env.MASTER_OWNER_EMAIL || "").toLowerCase()
    || to === (process.env.FOUNDER_EMAIL || "").toLowerCase();
  if (!allowed) {
    throw new Error("Matrix recipient not allowed");
  }

  const verified = await resolveVerifiedResendFromEmail();
  const results: EmailWorkflowTestResult[] = [];

  for (const row of MATRIX_TEMPLATES) {
    const testedAt = new Date().toISOString();
    try {
      const send = await sendBrandedEmail({
        to,
        templateId: row.templateId,
        subjectOverride: `Email Readiness — ${row.templateId}`,
        template: {
          recipientName: "Fahreal Allah",
          message:
            "IFCDC HQ Executive Email Readiness — Founder inbox template matrix probe.\n\n"
            + `Template: ${row.templateId}\n`
            + "This is a controlled production audit message.",
          fields: {
            email: to,
            role: "Founder / Super Admin",
            service: "Email Readiness Audit",
            when: testedAt,
            location: "IFCDC Headquarters",
            reference: `READINESS-${row.templateId}`,
            itemTitle: "Email readiness approval sample",
            actor: "AURA",
            grantTitle: "Email readiness grant sample",
            alertTitle: "Email readiness executive alert",
            reportDate: testedAt.slice(0, 10),
            name: "Audit contact",
          },
          cta: { label: "Open IFCDC HQ", href: "https://ifcdc-hq-wst6.onrender.com/hq" },
        },
      });
      results.push({
        workflowId: row.workflowId,
        name: row.name,
        result: send.success ? "PASS" : "FAIL",
        warnings: verified.usedFallback ? ["Sender used fallback domain"] : [],
        route: "POST /api/hq/email/readiness/run-matrix → sendBrandedEmail",
        sender: verified.from,
        recipient: to,
        template: row.templateId,
        httpStatus: send.success ? 200 : 502,
        resendAccepted: send.success,
        messageId: send.messageId || null,
        deliveryStatus: send.success ? "accepted" : "failed",
        securityObservations: [
          "Founder inbox only",
          "No secrets in body",
          verified.usedFallback ? "WARN: fallback From active" : "Official ifcdc.org From",
        ],
        testedAt,
        error: send.error,
      });
    } catch (err) {
      results.push({
        workflowId: row.workflowId,
        name: row.name,
        result: "FAIL",
        warnings: [],
        route: "POST /api/hq/email/readiness/run-matrix → sendBrandedEmail",
        sender: verified.from,
        recipient: to,
        template: row.templateId,
        httpStatus: null,
        resendAccepted: false,
        messageId: null,
        deliveryStatus: "failed",
        securityObservations: ["Founder inbox only"],
        testedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Mark not_configured inventory rows without live send
  for (const w of listEmailWorkflows()) {
    if (w.status === "not_configured") {
      results.push({
        workflowId: w.id,
        name: w.name,
        result: "NOT_CONFIGURED",
        warnings: [w.notes],
        route: w.routeOrService,
        sender: null,
        recipient: null,
        template: w.templateId,
        httpStatus: null,
        resendAccepted: null,
        messageId: null,
        deliveryStatus: "not_configured",
        securityObservations: w.securityNotes ? [w.securityNotes] : [],
        testedAt: new Date().toISOString(),
      });
    }
  }

  return results;
}
