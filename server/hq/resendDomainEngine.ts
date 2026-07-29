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

export async function deleteResendDomain(domainId: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, status, data } = await resendFetch(`/domains/${domainId}`, { method: "DELETE" });
  if (!ok) {
    return { ok: false, error: String(data.message || data.error || `Delete domain failed (${status})`) };
  }
  return { ok: true };
}

export const RESEND_EMERGENCY_FALLBACK_DOMAIN = "ifcdcbarbersapp.com";
export const RESEND_EMERGENCY_FROM =
  "IFCDC Headquarters <service@ifcdcbarbersapp.com>";

/**
 * Free Resend plans allow 1 domain. HQ needs ifcdc.org, but production currently
 * holds ifcdcbarbersapp.com. Replace is Founder-opt-in only — never auto-delete
 * a working verified sender domain (that outage is what this restore fixes).
 */
export async function replaceResendDomainWithTarget(domain = getTargetSenderDomain()): Promise<{
  ok: boolean;
  deleted: string[];
  created?: Awaited<ReturnType<typeof ensureResendDomainRegistered>>;
  message: string;
}> {
  const allow = String(process.env.RESEND_ALLOW_DOMAIN_REPLACE || "").toLowerCase() === "true";
  if (!allow) {
    return {
      ok: false,
      deleted: [],
      message:
        "Domain replace disabled. Set RESEND_ALLOW_DOMAIN_REPLACE=true on Render only when intentionally swapping domains. Prefer keeping ifcdcbarbersapp.com verified until ifcdc.org DNS is live.",
    };
  }
  const target = domain.toLowerCase();
  const existing = await listResendDomains();
  const already = existing.find((d) => d.name.toLowerCase() === target);
  if (already) {
    const detail = await getResendDomainDetail(already.id);
    return {
      ok: true,
      deleted: [],
      created: {
        created: false,
        domainId: already.id,
        name: already.name,
        status: detail?.status || already.status,
        records: detail?.records || [],
      },
      message: `${target} is already registered`,
    };
  }

  const deleted: string[] = [];
  for (const d of existing) {
    if (d.name.toLowerCase() === target) continue;
    const rem = await deleteResendDomain(d.id);
    if (!rem.ok) {
      return {
        ok: false,
        deleted,
        message: `Could not remove ${d.name}: ${rem.error}`,
      };
    }
    deleted.push(d.name);
    console.warn(`[resend-domain] removed ${d.name} to free plan slot for ${target}`);
  }

  const { ok, status, data } = await resendFetch("/domains", {
    method: "POST",
    body: JSON.stringify({ name: target }),
  });
  if (!ok) {
    return {
      ok: false,
      deleted,
      message: String(data.message || data.error || `Resend create domain failed (${status})`),
    };
  }
  const id = String(data.id || "");
  const detail = id ? await getResendDomainDetail(id) : null;
  const created = {
    created: true,
    domainId: id || undefined,
    name: String(data.name || target),
    status: detail?.status || String(data.status || "pending"),
    records: detail?.records || normalizeRecords(data.records),
  };
  return {
    ok: true,
    deleted,
    created,
    message: deleted.length
      ? `Replaced ${deleted.join(", ")} with ${target}`
      : `Registered ${target}`,
  };
}

function isPlanDomainLimitError(message: string): boolean {
  return /plan includes 1 domain|upgrade to add more|domain limit|too many domains/i.test(message);
}

/**
 * Restore the last known working Resend sender domain (ifcdcbarbersapp.com).
 * Re-registers + requests verify so OTP/booking/payment mail can send again.
 */
export async function restoreEmergencyResendSender(): Promise<{
  ok: boolean;
  domain: string;
  status?: string;
  verified: boolean;
  created: boolean;
  verifyMessage?: string;
  records: ResendDnsRecord[];
  error?: string;
}> {
  const domain = RESEND_EMERGENCY_FALLBACK_DOMAIN;
  const ensured = await ensureResendDomainRegistered(domain);
  if (ensured.error && !ensured.domainId) {
    return {
      ok: false,
      domain,
      verified: false,
      created: false,
      records: [],
      error: ensured.error,
    };
  }
  let status = (ensured.status || "").toLowerCase();
  let verified = status === "verified";
  let verifyMessage: string | undefined;
  if (ensured.domainId && !verified) {
    const v = await verifyResendDomain(domain);
    verifyMessage = v.message;
    status = (v.status || status).toLowerCase();
    verified = status === "verified" || v.ok;
  }
  const detail = ensured.domainId ? await getResendDomainDetail(ensured.domainId) : null;
  return {
    ok: verified || Boolean(ensured.domainId),
    domain,
    status: detail?.status || status,
    verified,
    created: Boolean(ensured.created),
    verifyMessage,
    records: detail?.records || ensured.records || [],
    error: verified ? undefined : verifyMessage || ensured.error || "Domain pending DNS verification",
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
  replaced?: string[];
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

    const errMsg = String(data.message || data.error || `Resend create domain failed (${status})`);
    // Auto-swap is OFF by default — deleting the only verified sender caused production outage.
    const allowReplace = String(process.env.RESEND_ALLOW_DOMAIN_REPLACE || "").toLowerCase() === "true";
    if (allowReplace && isPlanDomainLimitError(errMsg)) {
      const swapped = await replaceResendDomainWithTarget(domain);
      if (swapped.ok && swapped.created && !swapped.created.error) {
        return { ...swapped.created, replaced: swapped.deleted };
      }
      return {
        created: false,
        name: domain,
        records: [],
        error: swapped.message || errMsg,
        replaced: swapped.deleted,
      };
    }

    return {
      created: false,
      name: domain,
      records: [],
      error: errMsg,
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
  // Always restore last-known working sender first so mail can send while ifcdc.org DNS is pending.
  const emergency = await restoreEmergencyResendSender().catch((err) => ({
    ok: false,
    domain: RESEND_EMERGENCY_FALLBACK_DOMAIN,
    verified: false,
    created: false,
    records: [] as ResendDnsRecord[],
    error: err instanceof Error ? err.message : "emergency restore failed",
  }));

  const configuredFrom = resolveResendFromEmail();
  const probe = await probeResendSender();
  const fromDomain = configuredFrom.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase();
  const configuredOk = Boolean(
    fromDomain && (probe.domains || []).some((d) => d.name.toLowerCase() === fromDomain && d.status === "verified"),
  );
  const verifiedDomain = (probe.domains || []).find((d) => d.status === "verified");
  let fromEffective = configuredFrom;
  let usedFallback = false;
  if (!configuredOk && verifiedDomain) {
    const local =
      configuredFrom.match(/<([^@>]+)@/)?.[1]
      || configuredFrom.match(/^([^@\s]+)@/)?.[1]
      || "service";
    fromEffective = `IFCDC Headquarters <${local}@${verifiedDomain.name}>`;
    usedFallback = true;
  } else if (!configuredOk) {
    fromEffective = RESEND_EMERGENCY_FROM;
    usedFallback = true;
  }

  const ensured = await ensureResendDomainRegistered(domain);
  const registered = Boolean(ensured.domainId) && !ensured.error;
  const status = (ensured.status || "").toLowerCase();
  const verified = status === "verified";
  const fallbackRemoved = !usedFallback && verified;

  const guidance: string[] = [];
  if (emergency.verified) {
    guidance.push(
      `Emergency sender ${RESEND_EMERGENCY_FALLBACK_DOMAIN} is verified — outbound mail uses this until ifcdc.org DNS is complete.`,
    );
  } else if (emergency.error) {
    guidance.push(`Emergency domain restore: ${emergency.error}`);
  }
  if (ensured.error) guidance.push(ensured.error);
  if (!registered) {
    if (ensured.error && isPlanDomainLimitError(ensured.error)) {
      guidance.push(
        `Resend plan limit blocked ${domain}. Keep ${RESEND_EMERGENCY_FALLBACK_DOMAIN} verified for delivery. Upgrade Resend or set RESEND_ALLOW_DOMAIN_REPLACE=true only for a deliberate swap.`,
      );
    } else {
      guidance.push(`Register ${domain} in Resend (POST /api/hq/email/domain/ensure).`);
    }
  } else if (!verified) {
    guidance.push(
      `Publish the DNS records below at GoDaddy (nameservers ns19/ns20.domaincontrol.com), wait 5–30 minutes, then POST /api/hq/email/domain/verify.`,
    );
  } else if (usedFallback) {
    guidance.push(
      `Domain ${domain} is verified but RESEND_FROM_EMAIL still resolves to an unverified From. Set RESEND_FROM_EMAIL=IFCDC Headquarters <service@${domain}> on Render and Manual Deploy.`,
    );
  } else {
    guidance.push(`Sender domain ${domain} is verified. Fallback is not in use.`);
  }

  if ((ensured as { replaced?: string[] }).replaced?.length) {
    guidance.unshift(
      `Removed Resend domain(s) ${(ensured as { replaced?: string[] }).replaced!.join(", ")} so ${domain} could be registered.`,
    );
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
    fromEffective,
    usedFallback,
    fallbackRemoved,
    guidance,
    godaddySteps,
    error: ensured.error || (!probe.ok && !verified && !emergency.verified ? probe.error : undefined),
  };
}
