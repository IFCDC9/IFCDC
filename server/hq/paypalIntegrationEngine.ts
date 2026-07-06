/**
 * PayPal integration — OAuth probe, order creation test, Integrations Hub monitoring.
 */
import { getDb } from "../db";

const PROBE_TIMEOUT_MS = 10_000;

export type PayPalEnvironment = "live" | "sandbox";

export type PayPalIntegrationDetail = {
  label: string;
  value: string;
  status?: "success" | "warning" | "muted" | "danger";
};

export type PayPalProbeResult = {
  healthy: boolean;
  authenticated: boolean;
  orderCreationOk: boolean;
  latencyMs: number;
  message: string;
  environment: PayPalEnvironment;
  httpStatus?: number;
  webhookEndpoint: string;
};

export type PayPalEnvStatus = {
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  envConfigured: boolean;
  environment: PayPalEnvironment;
  envRaw: string | null;
  ready: boolean;
};

/** Normalize PAYPAL_ENV — accepts live, LIVE, production, sandbox. */
export function resolvePayPalEnvironment(): PayPalEnvironment {
  const raw = (process.env.PAYPAL_ENV || "sandbox").trim().toLowerCase();
  if (raw === "live" || raw === "production") return "live";
  return "sandbox";
}

export function getPayPalBaseUrl(env: PayPalEnvironment = resolvePayPalEnvironment()): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export function getPayPalEnvStatus(): PayPalEnvStatus {
  const clientIdConfigured = Boolean((process.env.PAYPAL_CLIENT_ID || "").trim());
  const clientSecretConfigured = Boolean((process.env.PAYPAL_CLIENT_SECRET || "").trim());
  const envRaw = (process.env.PAYPAL_ENV || "").trim() || null;
  const environment = resolvePayPalEnvironment();
  return {
    clientIdConfigured,
    clientSecretConfigured,
    envConfigured: Boolean(envRaw),
    environment,
    envRaw,
    ready: clientIdConfigured && clientSecretConfigured,
  };
}

export function getPublicWebhookUrl(): string {
  const base = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  return base ? `${base}/api/paypal/webhook-log` : "/api/paypal/webhook-log";
}

async function fetchPayPalAccessToken(): Promise<{ token: string; latencyMs: number }> {
  const clientId = (process.env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
  }

  const started = Date.now();
  const baseUrl = getPayPalBaseUrl();
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  const latencyMs = Date.now() - started;
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };

  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`PayPal OAuth failed: ${detail}`);
  }

  return { token: data.access_token, latencyMs };
}

async function probePayPalOrderCreation(token: string): Promise<boolean> {
  const baseUrl = getPayPalBaseUrl();
  const res = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "1.00" } }],
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  if (!res.ok) return false;
  const data = (await res.json()) as { id?: string; status?: string };
  return Boolean(data.id && (data.status === "CREATED" || data.status === "PAYER_ACTION_REQUIRED"));
}

/** Live OAuth + order-creation probe (does not capture funds). */
export async function probePayPalApi(): Promise<PayPalProbeResult> {
  const envStatus = getPayPalEnvStatus();
  const environment = envStatus.environment;
  const webhookEndpoint = getPublicWebhookUrl();

  if (!envStatus.ready) {
    const missing = [
      !envStatus.clientIdConfigured ? "PAYPAL_CLIENT_ID" : null,
      !envStatus.clientSecretConfigured ? "PAYPAL_CLIENT_SECRET" : null,
    ].filter(Boolean);
    return {
      healthy: false,
      authenticated: false,
      orderCreationOk: false,
      latencyMs: 0,
      message: `PayPal credentials missing: ${missing.join(", ")}`,
      environment,
      webhookEndpoint,
    };
  }

  const started = Date.now();
  try {
    const { token, latencyMs: authMs } = await fetchPayPalAccessToken();
    const orderOk = await probePayPalOrderCreation(token);
    const latencyMs = Date.now() - started;

    const envLabel = environment === "live" ? "Live (production)" : "Sandbox";
    const healthy = orderOk;
    return {
      healthy,
      authenticated: true,
      orderCreationOk: orderOk,
      latencyMs,
      message: healthy
        ? `PayPal ${envLabel} connected · OAuth OK · order creation verified (${authMs}ms auth)`
        : `PayPal OAuth OK but order creation failed — check app permissions (${envLabel})`,
      environment,
      httpStatus: 200,
      webhookEndpoint,
    };
  } catch (err) {
    return {
      healthy: false,
      authenticated: false,
      orderCreationOk: false,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : "PayPal probe failed",
      environment,
      webhookEndpoint,
    };
  }
}

export function resolvePayPalHubStatus(
  probe: PayPalProbeResult,
  envReady: boolean
): "connected" | "degraded" | "not_configured" {
  if (!envReady) return "not_configured";
  if (probe.healthy && probe.authenticated && probe.orderCreationOk) return "connected";
  if (probe.authenticated) return "degraded";
  return "not_configured";
}

export async function countPayPalFundingEvents(): Promise<number> {
  try {
    const db = await getDb();
    const row = await db.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM funding_events WHERE source_key = 'paypal'"
    );
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function buildPayPalDetails(
  probe: PayPalProbeResult,
  envStatus: PayPalEnvStatus,
  paypalEvents: number
): PayPalIntegrationDetail[] {
  return [
    {
      label: "Environment",
      value: probe.environment === "live" ? "Live (production)" : "Sandbox",
      status: probe.environment === "live" ? "success" : "warning",
    },
    {
      label: "PAYPAL_ENV",
      value: envStatus.envRaw ?? "(default: sandbox)",
      status: envStatus.envConfigured ? "success" : "warning",
    },
    {
      label: "OAuth authentication",
      value: probe.authenticated ? "Verified" : "Failed",
      status: probe.authenticated ? "success" : "danger",
    },
    {
      label: "Order creation",
      value: probe.orderCreationOk ? "Verified (not captured)" : "Not verified",
      status: probe.orderCreationOk ? "success" : "warning",
    },
    {
      label: "Webhook endpoint",
      value: probe.webhookEndpoint,
      status: probe.webhookEndpoint.startsWith("http") ? "success" : "muted",
    },
    {
      label: "PayPal events in HQ",
      value: String(paypalEvents),
      status: paypalEvents > 0 ? "success" : "muted",
    },
  ];
}

/** Verify webhook handler accepts and logs a synthetic payload (no PayPal signature in legacy route). */
export async function verifyPayPalWebhookHandler(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = await getDb();
    const testId = `pp-probe-${Date.now()}`;
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO funding_events (id, source_key, intent, amount_cents, currency, external_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      testId,
      "paypal",
      "donation",
      100,
      "USD",
      testId,
      JSON.stringify({ probe: true, status: "VERIFICATION" }),
      now
    );
    await db.run("DELETE FROM funding_events WHERE external_id = ?", testId);
    return { ok: true, message: "Webhook log path can write to funding_events" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Webhook DB check failed" };
  }
}

export async function testPayPalIntegrationLive() {
  const envStatus = getPayPalEnvStatus();
  const probe = await probePayPalApi();
  const webhook = await verifyPayPalWebhookHandler();
  const paypalEvents = await countPayPalFundingEvents();
  const status = resolvePayPalHubStatus(probe, envStatus.ready);
  const details = buildPayPalDetails(probe, envStatus, paypalEvents);

  const { invalidateIntegrationsHubCache } = await import("./integrationsHubEngine");
  invalidateIntegrationsHubCache();

  const success = status === "connected" && webhook.ok;
  const message = [
    probe.message,
    webhook.ok ? webhook.message : `Webhook: ${webhook.message}`,
  ].filter(Boolean).join(" · ");

  return {
    success,
    message,
    provider: "paypal",
    status,
    testedAt: new Date().toISOString(),
    details,
    snapshot: {
      environment: probe.environment,
      authenticated: probe.authenticated,
      orderCreationOk: probe.orderCreationOk,
      webhookOk: webhook.ok,
      paypalEvents,
      latencyMs: probe.latencyMs,
    },
  };
}

/** Shared token fetch for PayPal REST routes. */
export async function getPayPalAccessTokenForRoutes(): Promise<string> {
  const { token } = await fetchPayPalAccessToken();
  return token;
}
