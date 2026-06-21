/**
 * IFCDC Central Services Integration
 * Connect any IFCDC application to the unified backend services.
 */

export const IFCDC_SERVICE_URLS = {
  auth: process.env.IFCDC_AUTH_URL || "http://localhost:4100",
  aura: process.env.IFCDC_AURA_URL || "http://localhost:4101",
  notifications: process.env.IFCDC_NOTIFICATIONS_URL || "http://localhost:4102",
  payments: process.env.IFCDC_PAYMENTS_URL || "http://localhost:4103",
  database: process.env.IFCDC_DATABASE_URL || "http://localhost:4104",
} as const;

export async function checkServiceHealth(service: keyof typeof IFCDC_SERVICE_URLS): Promise<boolean> {
  try {
    const res = await fetch(`${IFCDC_SERVICE_URLS[service]}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function auraChat(message: string, appContext?: string): Promise<string> {
  const res = await fetch(`${IFCDC_SERVICE_URLS.aura}/api/aura/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: message }], appContext }),
  });
  if (!res.ok) throw new Error("AURA AI request failed");
  const data = await res.json();
  return data.response;
}

export async function sendNotification(payload: {
  to: string;
  body: string;
  channel: "email" | "sms" | "push" | "in-app";
  subject?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const res = await fetch(`${IFCDC_SERVICE_URLS.notifications}/api/notifications/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function createPaymentIntent(amount: number, currency = "usd", description?: string) {
  const res = await fetch(`${IFCDC_SERVICE_URLS.payments}/api/payments/create-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, currency, description }),
  });
  return res.json();
}

export async function verifyAuthToken(token: string) {
  const res = await fetch(`${IFCDC_SERVICE_URLS.auth}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.json();
}
