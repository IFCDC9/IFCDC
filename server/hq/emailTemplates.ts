/**
 * IFCDC HQ email template catalog — transactional + AURA-generated.
 */
import {
  HQ_EMAIL_BRAND,
  escapeHtml,
  plainToHtmlParagraphs,
  renderBrandedEmailShell,
  htmlToPlainText,
} from "./emailBrand";

export type EmailTemplateId =
  | "welcome"
  | "password_reset"
  | "booking_confirmation"
  | "appointment_reminder"
  | "approval_notification"
  | "denial_notification"
  | "grant_notification"
  | "contact_form"
  | "executive_alert"
  | "daily_report"
  | "aura_message"
  | "generic";

export type TemplateRenderInput = {
  recipientName?: string;
  subjectOverride?: string;
  /** Primary prose (plain text). */
  message?: string;
  /** Extra structured fields by template. */
  fields?: Record<string, string | number | boolean | null | undefined>;
  cta?: { label: string; href: string };
  moduleLabel?: string;
};

export type RenderedEmail = {
  templateId: EmailTemplateId;
  subject: string;
  html: string;
  text: string;
  module: string;
};

function nameOrFriend(name?: string): string {
  const n = (name || "").trim();
  return n || "there";
}

function field(fields: TemplateRenderInput["fields"], key: string, fallback = ""): string {
  const v = fields?.[key];
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function detailRows(rows: Array<[string, string]>): string {
  const filtered = rows.filter(([, v]) => Boolean(v && String(v).trim()));
  if (!filtered.length) return "";
  const items = filtered
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:6px 0;color:${HQ_EMAIL_BRAND.muted};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;width:38%;">${escapeHtml(k)}</td>
          <td style="padding:6px 0;color:${HQ_EMAIL_BRAND.white};font-size:14px;">${escapeHtml(v)}</td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:1rem 0 0;">${items}</table>`;
}

function statusPill(label: string, tone: "gold" | "success" | "danger" = "gold"): string {
  const color =
    tone === "success" ? HQ_EMAIL_BRAND.success : tone === "danger" ? HQ_EMAIL_BRAND.danger : HQ_EMAIL_BRAND.gold;
  return `<span style="display:inline-block;border:1px solid ${color};color:${color};padding:0.25rem 0.65rem;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(label)}</span>`;
}

type TemplateDef = {
  id: EmailTemplateId;
  module: string;
  label: string;
  defaultSubject: (input: TemplateRenderInput) => string;
  render: (input: TemplateRenderInput) => { title: string; subtitle?: string; bodyHtml: string; eyebrow?: string };
};

const TEMPLATES: Record<EmailTemplateId, TemplateDef> = {
  welcome: {
    id: "welcome",
    module: "auth",
    label: "Welcome",
    defaultSubject: () => "Welcome to IFCDC Headquarters",
    render: (input) => ({
      title: `Welcome, ${nameOrFriend(input.recipientName)}`,
      subtitle: "Your Headquarters access is ready.",
      bodyHtml: [
        plainToHtmlParagraphs(
          input.message
            || "You now have access to IFCDC Headquarters — the operating system for Imperial Foundation CDC. Sign in to manage grants, people, communications, and executive operations.",
        ),
        detailRows([
          ["Role", field(input.fields, "role")],
          ["Email", field(input.fields, "email")],
        ]),
      ].join(""),
    }),
  },
  password_reset: {
    id: "password_reset",
    module: "auth",
    label: "Password Reset",
    defaultSubject: () => "Reset your IFCDC Headquarters password",
    render: (input) => ({
      title: "Password reset",
      subtitle: "Secure link to restore your Founder or staff access.",
      bodyHtml: [
        plainToHtmlParagraphs(
          input.message
            || "We received a request to reset your Headquarters password. Use the button below within the next hour. If you did not request this, you can ignore this message.",
        ),
        detailRows([["Account", field(input.fields, "email")]]),
      ].join(""),
    }),
  },
  booking_confirmation: {
    id: "booking_confirmation",
    module: "bookings",
    label: "Booking Confirmation",
    defaultSubject: (input) =>
      `Booking confirmed${field(input.fields, "service") ? ` — ${field(input.fields, "service")}` : ""}`,
    render: (input) => ({
      title: "Booking confirmed",
      subtitle: "Your appointment is on the Headquarters calendar.",
      bodyHtml: [
        statusPill("Confirmed", "success"),
        plainToHtmlParagraphs(
          input.message || `Hello ${nameOrFriend(input.recipientName)}, your booking with IFCDC is confirmed.`,
        ),
        detailRows([
          ["Service", field(input.fields, "service")],
          ["When", field(input.fields, "when")],
          ["Location", field(input.fields, "location")],
          ["Reference", field(input.fields, "reference")],
        ]),
      ].join(""),
    }),
  },
  appointment_reminder: {
    id: "appointment_reminder",
    module: "bookings",
    label: "Appointment Reminder",
    defaultSubject: (input) =>
      `Reminder${field(input.fields, "when") ? `: ${field(input.fields, "when")}` : " — upcoming appointment"}`,
    render: (input) => ({
      title: "Appointment reminder",
      subtitle: "A courtesy reminder from IFCDC Headquarters.",
      bodyHtml: [
        statusPill("Upcoming", "gold"),
        plainToHtmlParagraphs(
          input.message || `Hello ${nameOrFriend(input.recipientName)}, this is a reminder of your upcoming appointment.`,
        ),
        detailRows([
          ["When", field(input.fields, "when")],
          ["Service", field(input.fields, "service")],
          ["Location", field(input.fields, "location")],
        ]),
      ].join(""),
    }),
  },
  approval_notification: {
    id: "approval_notification",
    module: "workflows",
    label: "Approval",
    defaultSubject: (input) => `Approved — ${field(input.fields, "itemTitle", "Headquarters request")}`,
    render: (input) => ({
      title: "Request approved",
      subtitle: field(input.fields, "itemTitle", "Your Headquarters request was approved."),
      bodyHtml: [
        statusPill("Approved", "success"),
        plainToHtmlParagraphs(input.message || "A Headquarters request has been approved."),
        detailRows([
          ["Item", field(input.fields, "itemTitle")],
          ["Approved by", field(input.fields, "actor")],
          ["Notes", field(input.fields, "notes")],
        ]),
      ].join(""),
    }),
  },
  denial_notification: {
    id: "denial_notification",
    module: "workflows",
    label: "Denial",
    defaultSubject: (input) => `Update — ${field(input.fields, "itemTitle", "Headquarters request")}`,
    render: (input) => ({
      title: "Request not approved",
      subtitle: field(input.fields, "itemTitle", "A Headquarters request was denied."),
      bodyHtml: [
        statusPill("Denied", "danger"),
        plainToHtmlParagraphs(input.message || "A Headquarters request was not approved."),
        detailRows([
          ["Item", field(input.fields, "itemTitle")],
          ["Reviewed by", field(input.fields, "actor")],
          ["Reason", field(input.fields, "reason")],
        ]),
      ].join(""),
    }),
  },
  grant_notification: {
    id: "grant_notification",
    module: "grants",
    label: "Grant Notification",
    defaultSubject: (input) =>
      `Grant update — ${field(input.fields, "grantTitle", "IFCDC opportunity")}`,
    render: (input) => ({
      title: "Grant workspace update",
      eyebrow: "GRANTS · IFCDC HEADQUARTERS",
      subtitle: field(input.fields, "grantTitle"),
      bodyHtml: [
        statusPill(field(input.fields, "status", "Update"), "gold"),
        plainToHtmlParagraphs(input.message || "There is a new update in the Grant Workspace."),
        detailRows([
          ["Opportunity", field(input.fields, "grantTitle")],
          ["Funder", field(input.fields, "funder")],
          ["Deadline", field(input.fields, "deadline")],
          ["Status", field(input.fields, "status")],
          ["Application", field(input.fields, "applicationId")],
        ]),
      ].join(""),
    }),
  },
  contact_form: {
    id: "contact_form",
    module: "communications",
    label: "Contact Form",
    defaultSubject: (input) =>
      `Contact form — ${field(input.fields, "topic", "New inquiry")}`,
    render: (input) => ({
      title: "New contact inquiry",
      subtitle: "Submitted through IFCDC channels.",
      bodyHtml: [
        plainToHtmlParagraphs(input.message || "A new contact form submission was received."),
        detailRows([
          ["From", field(input.fields, "fromName")],
          ["Email", field(input.fields, "fromEmail")],
          ["Phone", field(input.fields, "phone")],
          ["Topic", field(input.fields, "topic")],
        ]),
      ].join(""),
    }),
  },
  executive_alert: {
    id: "executive_alert",
    module: "executive",
    label: "Executive Alert",
    defaultSubject: (input) => field(input.fields, "alertTitle", "Executive alert — IFCDC Headquarters"),
    render: (input) => ({
      title: field(input.fields, "alertTitle", "Executive alert"),
      eyebrow: "EXECUTIVE · AURA",
      subtitle: "Priority notice for Founder Mode.",
      bodyHtml: [
        statusPill(field(input.fields, "priority", "High"), "gold"),
        plainToHtmlParagraphs(input.message || "AURA raised an executive alert for Headquarters."),
        detailRows([
          ["Source", field(input.fields, "source")],
          ["Module", field(input.fields, "module")],
        ]),
      ].join(""),
    }),
  },
  daily_report: {
    id: "daily_report",
    module: "executive",
    label: "Daily Report",
    defaultSubject: (input) =>
      `Daily briefing — ${field(input.fields, "date", new Date().toISOString().slice(0, 10))}`,
    render: (input) => ({
      title: "Daily executive briefing",
      eyebrow: "MISSION CONTROL",
      subtitle: field(input.fields, "date", "Today at IFCDC Headquarters"),
      bodyHtml: [
        plainToHtmlParagraphs(input.message || "Your daily Headquarters briefing is ready."),
        detailRows([
          ["Highlights", field(input.fields, "highlights")],
          ["Risks", field(input.fields, "risks")],
          ["Actions", field(input.fields, "actions")],
        ]),
      ].join(""),
    }),
  },
  aura_message: {
    id: "aura_message",
    module: "aura",
    label: "AURA Message",
    defaultSubject: (input) => field(input.fields, "subjectHint", "Message from AURA · IFCDC Headquarters"),
    render: (input) => ({
      title: field(input.fields, "headline", "Message from AURA"),
      eyebrow: "AURA · IFCDC HEADQUARTERS",
      subtitle: field(input.fields, "contextLabel", "Personalized for Founder Mode"),
      bodyHtml: plainToHtmlParagraphs(
        input.message || "AURA prepared this message from live Headquarters context.",
      ),
    }),
  },
  generic: {
    id: "generic",
    module: "communications",
    label: "Generic",
    defaultSubject: () => "IFCDC Headquarters",
    render: (input) => ({
      title: field(input.fields, "headline", "IFCDC Headquarters"),
      bodyHtml: plainToHtmlParagraphs(input.message || ""),
    }),
  },
};

export function listEmailTemplates(): Array<{ id: EmailTemplateId; label: string; module: string }> {
  return Object.values(TEMPLATES).map((t) => ({ id: t.id, label: t.label, module: t.module }));
}

export function getEmailTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES[id as EmailTemplateId];
}

export function renderEmailTemplate(
  templateId: EmailTemplateId,
  input: TemplateRenderInput = {},
): RenderedEmail {
  const def = TEMPLATES[templateId] || TEMPLATES.generic;
  const rendered = def.render(input);
  const subject = (input.subjectOverride || def.defaultSubject(input)).trim();
  const html = renderBrandedEmailShell({
    title: rendered.title,
    subtitle: rendered.subtitle,
    eyebrow: rendered.eyebrow || input.moduleLabel || def.module.toUpperCase(),
    bodyHtml: rendered.bodyHtml,
    cta: input.cta,
    moduleLabel: input.moduleLabel,
    preheader: subject,
  });
  return {
    templateId: def.id,
    subject,
    html,
    text: htmlToPlainText(html),
    module: def.module,
  };
}

/** Map HQ module hints to a default template. */
export function templateForModule(module?: string): EmailTemplateId {
  const m = (module || "").toLowerCase();
  if (m.includes("grant")) return "grant_notification";
  if (m.includes("book") || m.includes("appoint")) return "appointment_reminder";
  if (m.includes("exec") || m.includes("alert")) return "executive_alert";
  if (m.includes("auth") || m.includes("welcome")) return "welcome";
  if (m.includes("contact")) return "contact_form";
  if (m.includes("aura")) return "aura_message";
  if (m.includes("report") || m.includes("brief")) return "daily_report";
  return "aura_message";
}
