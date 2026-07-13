/**
 * IFCDC Headquarters Production Email Engine
 *
 * Branded HTML (black/gold/white) + verified Resend sender + AURA personalization.
 * Transport stays on the existing Resend path — no new microservice/package.
 */
import {
  resolveResendFromEmail,
  resolveVerifiedResendFromEmail,
  probeResendSender,
  type HqDeliveryResult,
} from "../lib/notifications";
import { auraExecutiveChat } from "../lib/ifcdc";
import { HQ_EMAIL_BRAND, htmlToPlainText } from "./emailBrand";
import {
  type EmailTemplateId,
  type TemplateRenderInput,
  listEmailTemplates,
  renderEmailTemplate,
  templateForModule,
} from "./emailTemplates";

export type SendBrandedEmailInput = {
  to: string | string[];
  templateId: EmailTemplateId;
  template?: TemplateRenderInput;
  /** Optional pre-rendered HTML (skips template body compose). */
  htmlOverride?: string;
  textOverride?: string;
  subjectOverride?: string;
  replyTo?: string;
};

export type SenderAuthStatus = {
  configured: boolean;
  from: string;
  fromDomain: string | null;
  domainVerified: boolean;
  usedFallback: boolean;
  fallbackFrom?: string;
  spf: { status: string; detail?: string };
  dkim: { status: string; detail?: string };
  dmarc: { status: string; detail?: string };
  records: Array<{ record: string; name?: string; type?: string; value?: string; status?: string; ttl?: string }>;
  domains: Array<{ name: string; status: string }>;
  trustedSender: boolean;
  guidance: string[];
  error?: string;
};

function resolveResendApiKeyLocal(): string | null {
  return (
    (process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY || process.env.SMTP_API_KEY || "").trim() || null
  );
}

function parseFromDomain(from: string): string | null {
  return from.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase() || null;
}

async function fetchDomainAuthRecords(domainName: string): Promise<{
  records: SenderAuthStatus["records"];
  spf: SenderAuthStatus["spf"];
  dkim: SenderAuthStatus["dkim"];
  dmarc: SenderAuthStatus["dmarc"];
  error?: string;
}> {
  const apiKey = resolveResendApiKeyLocal();
  const empty = {
    records: [] as SenderAuthStatus["records"],
    spf: { status: "unknown" as const, detail: "Not probed" },
    dkim: { status: "unknown" as const, detail: "Not probed" },
    dmarc: { status: "unknown" as const, detail: "Not probed" },
  };
  if (!apiKey) return { ...empty, error: "RESEND_API_KEY not set" };

  try {
    const listRes = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    const listData = (await listRes.json().catch(() => ({}))) as {
      data?: Array<{ id: string; name: string; status: string }>;
    };
    const match = (listData.data || []).find((d) => d.name.toLowerCase() === domainName.toLowerCase());
    if (!match) {
      return {
        ...empty,
        spf: { status: "missing", detail: `Domain ${domainName} not in Resend` },
        dkim: { status: "missing", detail: `Domain ${domainName} not in Resend` },
        dmarc: { status: "missing", detail: `Domain ${domainName} not in Resend` },
        error: `Domain ${domainName} is not registered in Resend`,
      };
    }

    const detailRes = await fetch(`https://api.resend.com/domains/${match.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    const detail = (await detailRes.json().catch(() => ({}))) as {
      records?: Array<{
        record?: string;
        name?: string;
        type?: string;
        value?: string;
        status?: string;
        ttl?: string;
      }>;
      status?: string;
      message?: string;
    };
    if (!detailRes.ok) {
      return {
        ...empty,
        error: detail.message || `Resend domain detail ${detailRes.status}`,
      };
    }

    const records = (detail.records || []).map((r) => ({
      record: String(r.record || r.type || "DNS"),
      name: r.name,
      type: r.type,
      value: r.value,
      status: r.status,
      ttl: r.ttl,
    }));

    const pick = (names: string[]) =>
      records.find((r) => names.some((n) => (r.record || "").toUpperCase().includes(n)));

    const spfRec = pick(["SPF"]);
    const dkimRec = pick(["DKIM"]);
    const dmarcRec = pick(["DMARC"]);

    const normalize = (rec?: SenderAuthStatus["records"][number], label = "record") => {
      if (!rec) return { status: "missing", detail: `${label} not returned by Resend for ${domainName}` };
      const st = (rec.status || "").toLowerCase();
      if (st === "verified" || st === "passed" || st === "valid") {
        return { status: "verified", detail: rec.value?.slice(0, 120) };
      }
      if (st) return { status: st, detail: rec.value?.slice(0, 120) };
      return { status: "pending", detail: rec.value?.slice(0, 120) };
    };

    return {
      records,
      spf: normalize(spfRec, "SPF"),
      dkim: normalize(dkimRec, "DKIM"),
      dmarc: normalize(dmarcRec, "DMARC"),
    };
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : "Domain auth probe failed",
    };
  }
}

/** Live SPF / DKIM / DMARC readiness for the configured (or fallback) From domain. */
export async function getSenderAuthStatus(): Promise<SenderAuthStatus> {
  const apiKey = resolveResendApiKeyLocal();
  const configuredFrom = resolveResendFromEmail();
  const guidance: string[] = [];

  if (!apiKey) {
    return {
      configured: false,
      from: configuredFrom,
      fromDomain: parseFromDomain(configuredFrom),
      domainVerified: false,
      usedFallback: false,
      spf: { status: "unknown" },
      dkim: { status: "unknown" },
      dmarc: { status: "unknown" },
      records: [],
      domains: [],
      trustedSender: false,
      guidance: ["Set RESEND_API_KEY on Render ifcdc-hq.", "Verify ifcdc.org (or your sender domain) in Resend."],
      error: "RESEND_API_KEY not set",
    };
  }

  const verified = await resolveVerifiedResendFromEmail();
  const from = verified.from;
  const fromDomain = parseFromDomain(from);
  const probe = verified.probe;
  const auth = fromDomain
    ? await fetchDomainAuthRecords(fromDomain)
    : {
        records: [],
        spf: { status: "missing", detail: "No from domain" },
        dkim: { status: "missing", detail: "No from domain" },
        dmarc: { status: "missing", detail: "No from domain" },
      };

  if (verified.usedFallback) {
    guidance.push(
      `Configured From (${verified.configuredFrom}) is not verified — sending via fallback ${from}. Update RESEND_FROM_EMAIL to a verified domain to remove Unverified Sender warnings.`,
    );
  }
  if (auth.spf.status !== "verified") {
    guidance.push("Add/verify the SPF record Resend provides for your domain in DNS.");
  }
  if (auth.dkim.status !== "verified") {
    guidance.push("Add/verify the DKIM CNAME records from Resend in DNS.");
  }
  if (auth.dmarc.status !== "verified" && auth.dmarc.status !== "unknown") {
    guidance.push("Publish a DMARC TXT record (e.g. v=DMARC1; p=none; rua=mailto:service@ifcdc.org).");
  }
  if (!guidance.length) {
    guidance.push("Sender domain is verified with SPF/DKIM in Resend — mail should authenticate.");
  }

  const domainVerified = Boolean(
    (probe.domains || []).some((d) => d.name.toLowerCase() === (fromDomain || "") && d.status === "verified")
      || (verified.usedFallback && fromDomain),
  );

  return {
    configured: true,
    from,
    fromDomain,
    domainVerified,
    usedFallback: verified.usedFallback,
    fallbackFrom: verified.usedFallback ? from : undefined,
    spf: auth.spf,
    dkim: auth.dkim,
    dmarc: auth.dmarc,
    records: auth.records,
    domains: probe.domains || [],
    trustedSender: domainVerified && auth.dkim.status === "verified" && auth.spf.status !== "missing",
    guidance,
    error: auth.error || probe.error,
  };
}

async function resendSend(opts: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<HqDeliveryResult & { from?: string; usedFallback?: boolean; senderAuth?: SenderAuthStatus }> {
  const apiKey = resolveResendApiKeyLocal();
  if (!apiKey) {
    return { success: false, error: "RESEND_API_KEY is not configured on Headquarters (Render env)" };
  }

  const verified = await resolveVerifiedResendFromEmail();
  try {
    console.log(
      `[email-engine] Resend → to=${opts.to.join(",")} from=${verified.from} subject=${opts.subject}`
        + (verified.usedFallback ? ` (fallback from ${verified.configuredFrom})` : ""),
    );
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: verified.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
      error?: string;
    };
    if (!res.ok) {
      return {
        success: false,
        error: data.message || data.error || data.name || `Resend error ${res.status}`,
        providerCode: data.name || res.status,
        providerStatus: res.status,
        providerResponse: data as Record<string, unknown>,
        from: verified.from,
        usedFallback: verified.usedFallback,
      };
    }
    return {
      success: true,
      messageId: data.id,
      providerStatus: res.status,
      providerResponse: data as Record<string, unknown>,
      from: verified.from,
      usedFallback: verified.usedFallback,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    return { success: false, error: message, from: verified.from, usedFallback: verified.usedFallback };
  }
}

/** Render a catalog template and send via verified Resend From. */
export async function sendBrandedEmail(input: SendBrandedEmailInput): Promise<
  HqDeliveryResult & {
    from?: string;
    usedFallback?: boolean;
    templateId: EmailTemplateId;
    subject: string;
    previewText?: string;
  }
> {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (!recipients.length) {
    return { success: false, error: "No valid recipients", templateId: input.templateId, subject: "" };
  }

  const rendered = renderEmailTemplate(input.templateId, input.template || {});
  const subject = (input.subjectOverride || rendered.subject).trim();
  const html = input.htmlOverride || rendered.html;
  const text = input.textOverride || rendered.text || htmlToPlainText(html);

  const send = await resendSend({
    to: recipients,
    subject,
    text,
    html,
    replyTo: input.replyTo || HQ_EMAIL_BRAND.supportEmail,
  });

  return {
    ...send,
    templateId: input.templateId,
    subject,
    previewText: text.slice(0, 160),
  };
}

/** Detect fixed acceptance / placeholder copy that should not go out as production content. */
export function isPlaceholderEmailBody(body: string): boolean {
  const t = (body || "").trim();
  if (!t) return true;
  if (/^AURA Founder Test\b/i.test(t)) return true;
  if (/This is a live production email from AURA confirming that Founder Mode/i.test(t)) return true;
  if (/^Message from IFCDC AURA$/i.test(t)) return true;
  if (/placeholder|lorem ipsum|test message only/i.test(t) && t.length < 80) return true;
  return false;
}

export type AuraEmailComposeInput = {
  to: string;
  intent: string;
  context?: string;
  module?: string;
  recipientName?: string;
  /** Seed body if AURA is unavailable — still wrapped in branded HTML. */
  fallbackBody?: string;
  subjectHint?: string;
};

/** Ask AURA to write a personalized email, then wrap in HQ branding. */
export async function composeAuraEmail(input: AuraEmailComposeInput): Promise<{
  subject: string;
  body: string;
  html: string;
  text: string;
  templateId: EmailTemplateId;
  generatedBy: "aura" | "fallback";
}> {
  const templateId = templateForModule(input.module || "aura");
  const system = [
    "You are AURA, executive operating system for IFCDC Headquarters (Imperial Foundation CDC).",
    "Write a concise, professional email in plain text (no markdown, no HTML).",
    "Return ONLY valid JSON: {\"subject\":\"...\",\"body\":\"...\",\"headline\":\"...\"}",
    "Tone: executive, warm, precise. Never invent grants, money, or approvals.",
    "Never include multi-step test instructions or tool names.",
    `Recipient: ${input.to}`,
    input.recipientName ? `Recipient name: ${input.recipientName}` : "",
    input.module ? `HQ module: ${input.module}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let subject = input.subjectHint || "Message from AURA · IFCDC Headquarters";
  let body = input.fallbackBody || "";
  let headline = "Message from AURA";
  let generatedBy: "aura" | "fallback" = "fallback";

  try {
    const raw = await auraExecutiveChat(
      `Compose an email.\nIntent: ${input.intent}\n${input.context ? `Context:\n${input.context.slice(0, 4000)}` : ""}`,
      system,
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { subject?: string; body?: string; headline?: string };
      if (parsed.subject?.trim()) subject = parsed.subject.trim().slice(0, 160);
      if (parsed.body?.trim()) body = parsed.body.trim().slice(0, 4000);
      if (parsed.headline?.trim()) headline = parsed.headline.trim().slice(0, 120);
      generatedBy = "aura";
    } else if (raw.trim().length > 40) {
      body = raw.trim().slice(0, 4000);
      generatedBy = "aura";
    }
  } catch (err) {
    console.warn("[email-engine] AURA compose failed, using fallback:", err instanceof Error ? err.message : err);
  }

  if (!body.trim()) {
    body =
      input.fallbackBody
      || `Hello,\n\nAURA at IFCDC Headquarters is following up regarding: ${input.intent}.\n\nPlease sign in to Headquarters for full context.\n\n— AURA`;
    generatedBy = "fallback";
  }

  // Never ship placeholder acceptance copy as production AURA email.
  if (isPlaceholderEmailBody(body)) {
    body = `Hello,\n\nAURA prepared this update from IFCDC Headquarters regarding: ${input.intent}.\n\nOpen Headquarters for live details and next actions.\n\n— AURA · IFCDC Headquarters`;
    generatedBy = "fallback";
  }

  const rendered = renderEmailTemplate("aura_message", {
    recipientName: input.recipientName,
    subjectOverride: subject,
    message: body,
    fields: {
      headline,
      subjectHint: subject,
      contextLabel: input.module ? `Module: ${input.module}` : "Founder Mode",
    },
    cta: {
      label: "Open Headquarters",
      href: `${HQ_EMAIL_BRAND.publicUrl()}/hq`,
    },
  });

  return {
    subject: rendered.subject,
    body,
    html: rendered.html,
    text: rendered.text,
    templateId,
    generatedBy,
  };
}

/** Send AURA-composed branded email (production path for Founder Mode). */
export async function sendAuraGeneratedEmail(input: AuraEmailComposeInput & { to: string | string[] }): Promise<
  HqDeliveryResult & {
    subject: string;
    generatedBy: "aura" | "fallback";
    from?: string;
    usedFallback?: boolean;
    bodyPreview?: string;
  }
> {
  const toList = Array.isArray(input.to) ? input.to : [input.to];
  const primary = toList[0] || "";
  const composed = await composeAuraEmail({ ...input, to: primary });
  const send = await resendSend({
    to: toList.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")),
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    replyTo: HQ_EMAIL_BRAND.supportEmail,
  });
  return {
    ...send,
    subject: composed.subject,
    generatedBy: composed.generatedBy,
    bodyPreview: composed.body.slice(0, 160),
  };
}

// ── Module convenience APIs ───────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  to: string;
  name?: string;
  role?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: "welcome",
    template: {
      recipientName: opts.name,
      fields: { email: opts.to, role: opts.role || "Member" },
      cta: { label: "Sign in to Headquarters", href: `${HQ_EMAIL_BRAND.publicUrl()}/login` },
    },
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
  name?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: "password_reset",
    template: {
      recipientName: opts.name,
      fields: { email: opts.to },
      cta: { label: "Reset password", href: opts.resetUrl },
    },
  });
}

export async function sendBookingConfirmationEmail(opts: {
  to: string;
  name?: string;
  service?: string;
  when?: string;
  location?: string;
  reference?: string;
  message?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: "booking_confirmation",
    template: {
      recipientName: opts.name,
      message: opts.message,
      fields: {
        service: opts.service,
        when: opts.when,
        location: opts.location,
        reference: opts.reference,
      },
    },
  });
}

export async function sendAppointmentReminderEmail(opts: {
  to: string;
  name?: string;
  service?: string;
  when?: string;
  location?: string;
  message?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: "appointment_reminder",
    template: {
      recipientName: opts.name,
      message: opts.message,
      fields: { service: opts.service, when: opts.when, location: opts.location },
    },
  });
}

export async function sendApprovalEmail(opts: {
  to: string;
  itemTitle: string;
  actor?: string;
  notes?: string;
  approved: boolean;
  message?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: opts.approved ? "approval_notification" : "denial_notification",
    template: {
      message: opts.message,
      fields: {
        itemTitle: opts.itemTitle,
        actor: opts.actor,
        notes: opts.notes,
        reason: opts.notes,
      },
      cta: { label: "Open Headquarters", href: `${HQ_EMAIL_BRAND.publicUrl()}/hq` },
    },
  });
}

export async function sendGrantNotificationEmail(opts: {
  to: string;
  grantTitle: string;
  funder?: string;
  deadline?: string;
  status?: string;
  applicationId?: string;
  message?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: "grant_notification",
    template: {
      message: opts.message,
      fields: {
        grantTitle: opts.grantTitle,
        funder: opts.funder,
        deadline: opts.deadline,
        status: opts.status,
        applicationId: opts.applicationId,
      },
      cta: {
        label: "Open Grant Workspace",
        href: `${HQ_EMAIL_BRAND.publicUrl()}/hq/grants`,
      },
    },
  });
}

export async function sendContactFormEmail(opts: {
  to?: string;
  fromName: string;
  fromEmail: string;
  phone?: string;
  topic?: string;
  message: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to || HQ_EMAIL_BRAND.supportEmail,
    templateId: "contact_form",
    template: {
      message: opts.message,
      fields: {
        fromName: opts.fromName,
        fromEmail: opts.fromEmail,
        phone: opts.phone,
        topic: opts.topic,
      },
    },
    replyTo: opts.fromEmail,
  });
}

export async function sendExecutiveAlertEmail(opts: {
  to: string;
  alertTitle: string;
  message: string;
  source?: string;
  module?: string;
  priority?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: "executive_alert",
    template: {
      message: opts.message,
      fields: {
        alertTitle: opts.alertTitle,
        source: opts.source,
        module: opts.module,
        priority: opts.priority || "High",
      },
      cta: { label: "Open Mission Control", href: `${HQ_EMAIL_BRAND.publicUrl()}/hq` },
    },
  });
}

export async function sendDailyReportEmail(opts: {
  to: string;
  date?: string;
  message: string;
  highlights?: string;
  risks?: string;
  actions?: string;
}): Promise<HqDeliveryResult> {
  return sendBrandedEmail({
    to: opts.to,
    templateId: "daily_report",
    template: {
      message: opts.message,
      fields: {
        date: opts.date || new Date().toISOString().slice(0, 10),
        highlights: opts.highlights,
        risks: opts.risks,
        actions: opts.actions,
      },
      cta: { label: "Open briefing", href: `${HQ_EMAIL_BRAND.publicUrl()}/hq` },
    },
  });
}

export function emailEngineCatalog() {
  return {
    brand: {
      colors: { black: HQ_EMAIL_BRAND.black, gold: HQ_EMAIL_BRAND.gold, white: HQ_EMAIL_BRAND.white },
      orgName: HQ_EMAIL_BRAND.orgName,
      productName: HQ_EMAIL_BRAND.productName,
    },
    templates: listEmailTemplates(),
  };
}

export { listEmailTemplates, renderEmailTemplate, probeResendSender };
