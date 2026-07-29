/**
 * Resend domain registration & verification for IFCDC Headquarters.
 * Registers ifcdc.org (or RESEND_DOMAIN) and surfaces DNS records for GoDaddy.
 * Does not modify DNS — Founder publishes records at the DNS host, then verify.
 */
import {
  resolveResendFromEmail,
  resolveVerifiedResendFromEmail,
  probeResendSender,
} from "../lib/notifications";

export type ResendDnsRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string;
  ttl?: string;
  priority?: number;
};

export type ResendDomainState = {
  targetDomain: string;
  registered: boolean;
  verified: boolean;
  domainId?: string;
  status?: string;
  records: ResendDnsRecord[];
  fromConfigured: string;
  fromEffective: string;
  usedFallback: boolean;
  fallbackRemoved: boolean;
  guidance: string[];
  godaddySteps: string[];
  error?: string;
};

function resolveApiKey(): string | null {
  const key = (
    process.env.RESEND_API_KEY
    || process.env.EMAIL_API_KEY
    || process.env.SMTP_API_KEY
    || ""
  ).trim();
  return key || null;
}

export function getTargetSenderDomain(): string {
  const explicit = (process.env.RESEND_DOMAIN || "").trim().toLowerCase();
  if (explicit) return explicit.replace(/^@/, "");
  const from = resolveResendFromEmail();
  const parsed = from.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase();
  return parsed || "ifcdc.org";
}

async function resendFetch(path: string, init?: RequestInit): Promise<{
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}> {
  const apiKey = resolveApiKey();
  if (!apiKey) return { ok: false, status: 0, data: { error: "RESEND_API_KEY not set" } };
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function normalizeRecords(raw: unknown): ResendDnsRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      record: String(row.record || row.type || "DNS"),
      name: String(row.name || ""),
      type: String(row.type || ""),
      value: String(row.value || ""),
      status: row.status ? String(row.status) : undefined,
      ttl: row.ttl ? String(row.ttl) : undefined,
      priority: typeof row.priority === "number" ? row.priority : undefined,
    };
  });
}

export async function listResendDomains(): Promise<Array<{ id: string; name: string; status: string }>> {
  const { ok, data } = await resendFetch("/domains");
  if (!ok) return [];
  const list = (data.data as Array<{ id: string; name: string; status: string }> | undefined) || [];
  return list.map((d) => ({ id: d.id, name: d.name, status: d.status }));
}

export async function getResendDomainDetail(domainId: string): Promise<{
  id: string;
  name: string;
  status: string;
  records: ResendDnsRecord[];
} | null> {
  const { ok, data } = await resendFetch(`/domains/${domainId}`);
  if (!ok) return null;
  return {
    id: String(data.id || domainId),
    name: String(data.name || ""),
    status: String(data.status || "unknown"),
    records: normalizeRecords(data.records),
  };
}

/** Create domain in Resend if missing (idempotent). */
export async function ensureResendDomainRegistered(domain = getTargetSenderDomain()): Promise<{
  created: boolean;
  domainId?: string;
  name: string;
  status?: string;
  records: ResendDnsRecord[];
  error?: string;
}> {
  const existing = await listResendDomains();
  const match = existing.find((d) => d.name.toLowerCase() === domain.toLowerCase());
  if (match) {
    const detail = await getResendDomainDetail(match.id);
    return {
      created: false,
      domainId: match.id,
      name: match.name,
      status: detail?.status || match.status,
      records: detail?.records || [],
    };
  }

  const { ok, status, data } = await resendFetch("/domains", {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (!ok) {
    // Already exists race
    if (status === 409 || /already|exists/i.test(String(data.message || data.error || ""))) {
      const again = await listResendDomains();
      const m = again.find((d) => d.name.toLowerCase() === domain.toLowerCase());
      if (m) {
        const detail = await getResendDomainDetail(m.id);
        return {
          created: false,
          domainId: m.id,
          name: m.name,
          status: detail?.status || m.status,
          records: detail?.records || [],
        };
      }
    }
    return {
      created: false,
      name: domain,
      records: [],
      error: String(data.message || data.error || `Resend create domain failed (${status})`),
    };
  }

  const id = String(data.id || "");
  const detail = id ? await getResendDomainDetail(id) : null;
  return {
    created: true,
    domainId: id || undefined,
    name: String(data.name || domain),
    status: detail?.status || String(data.status || "pending"),
    records: detail?.records || normalizeRecords(data.records),
  };
}

export async function verifyResendDomain(domain = getTargetSenderDomain()): Promise<{
  ok: boolean;
  status?: string;
  message: string;
  domainId?: string;
}> {
  const existing = await listResendDomains();
  const match = existing.find((d) => d.name.toLowerCase() === domain.toLowerCase());
  if (!match) {
    return { ok: false, message: `Domain ${domain} is not registered in Resend yet` };
  }
  const { ok, data, status } = await resendFetch(`/domains/${match.id}/verify`, { method: "POST" });
  if (!ok) {
    return {
      ok: false,
      domainId: match.id,
      status: String(data.status || ""),
      message: String(data.message || data.error || `Verify failed (${status})`),
    };
  }
  const detail = await getResendDomainDetail(match.id);
  const verified = (detail?.status || "").toLowerCase() === "verified";
  return {
    ok: verified,
    domainId: match.id,
    status: detail?.status,
    message: verified
      ? `${domain} is verified in Resend — set RESEND_FROM_EMAIL to use this domain and remove fallback`
      : `${domain} verify requested; status=${detail?.status || "pending"}. Wait for DNS propagation, then retry.`,
  };
}

export async function getResendDomainSetupState(domain = getTargetSenderDomain()): Promise<ResendDomainState> {
  const configuredFrom = resolveResendFromEmail();
  const verifiedFrom = await resolveVerifiedResendFromEmail();
  const probe = await probeResendSender();
  const ensured = await ensureResendDomainRegistered(domain);
  const registered = Boolean(ensured.domainId) && !ensured.error;
  const status = (ensured.status || "").toLowerCase();
  const verified = status === "verified";
  const fallbackRemoved = !verifiedFrom.usedFallback && verified;

  const guidance: string[] = [];
  if (ensured.error) guidance.push(ensured.error);
  if (!registered) {
    guidance.push(`Register ${domain} in Resend (POST /api/hq/email/domain/ensure).`);
  } else if (!verified) {
    guidance.push(
      `Publish the DNS records below at GoDaddy (nameservers ns19/ns20.domaincontrol.com), wait 5–30 minutes, then POST /api/hq/email/domain/verify.`,
    );
  } else if (verifiedFrom.usedFallback) {
    guidance.push(
      `Domain ${domain} is verified but RESEND_FROM_EMAIL still resolves to an unverified From. Set RESEND_FROM_EMAIL=IFCDC Headquarters <service@${domain}> on Render and Manual Deploy.`,
    );
  } else {
    guidance.push(`Sender domain ${domain} is verified. Fallback is not in use.`);
  }

  const godaddySteps = [
    "Sign in to GoDaddy → DNS for ifcdc.org",
    "Add each Resend record exactly (TXT / MX / CNAME as listed)",
    "Do not delete existing Outlook MX unless migrating mail — Resend uses send.<domain> hostnames",
    "Recommended DMARC TXT at _dmarc: v=DMARC1; p=none; rua=mailto:service@ifcdc.org",
    "After DNS saves, run Verify Domain in Integrations Hub or POST /api/hq/email/domain/verify",
    "On Render set RESEND_FROM_EMAIL=IFCDC Headquarters <service@ifcdc.org> then Manual Deploy",
  ];

  return {
    targetDomain: domain,
    registered,
    verified,
    domainId: ensured.domainId,
    status: ensured.status,
    records: ensured.records,
    fromConfigured: configuredFrom,
    fromEffective: verifiedFrom.from,
    usedFallback: verifiedFrom.usedFallback,
    fallbackRemoved,
    guidance,
    godaddySteps,
    error: ensured.error || (!probe.ok && !verified ? probe.error : undefined),
  };
}
