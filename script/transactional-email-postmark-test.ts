/**
 * Transactional email guard tests. No live email.
 * Provider tokens are generated in this process and are never printed.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  buildTransactionalEmailFindings,
  probeTransactionalEmail,
  redactEmailSecrets,
  resetTransactionalEmailGuardsForTests,
  resolveTransactionalFromAddress,
  sendTransactionalEmail,
  setTransactionalEmailLimitsForTests,
  transactionalSenderEmail,
} from "../server/lib/transactionalEmail.ts";

const savedEnv = {
  POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_API_KEY: process.env.EMAIL_API_KEY,
  SMTP_API_KEY: process.env.SMTP_API_KEY,
  AI_INTEGRATIONS_RESEND_API_KEY: process.env.AI_INTEGRATIONS_RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  EMAIL_FROM: process.env.EMAIL_FROM,
  SMTP_FROM: process.env.SMTP_FROM,
  IFCDC_EMAIL_ALLOW_MOCK_TRANSPORT: process.env.IFCDC_EMAIL_ALLOW_MOCK_TRANSPORT,
  IFCDC_EMAIL_DISABLE_SEND: process.env.IFCDC_EMAIL_DISABLE_SEND,
  NODE_ENV: process.env.NODE_ENV,
};

type Call = { url: string; tokenHeaderPresent: boolean; tokenMatched: boolean; authorizationPresent: boolean };

function installFetch(handler: (url: string, init: RequestInit | undefined, token: string) => Promise<Response> | Response, token: string): Call[] {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const headerToken = headers.get("X-Postmark-Server-Token") || "";
    calls.push({
      url,
      tokenHeaderPresent: Boolean(headerToken),
      tokenMatched: Boolean(token) && headerToken === token,
      authorizationPresent: Boolean(headers.get("Authorization")),
    });
    return handler(url, init, token);
  }) as typeof fetch;
  return Object.assign(calls, { restore: () => { globalThis.fetch = original; } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeCredential(prefix: string): string {
  return `${prefix}-${randomBytes(12).toString("hex")}`;
}

function assertNoTokenLeak(token: string, ...texts: Array<string | undefined>): void {
  for (const text of texts) {
    if (text && token && text.includes(token)) {
      throw new Error("A provider credential appeared in an error or log string");
    }
  }
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_API_KEY;
  delete process.env.SMTP_API_KEY;
  delete process.env.AI_INTEGRATIONS_RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.EMAIL_FROM;
  delete process.env.SMTP_FROM;
  delete process.env.IFCDC_EMAIL_DISABLE_SEND;
  process.env.IFCDC_EMAIL_ALLOW_MOCK_TRANSPORT = "1";
  resetTransactionalEmailGuardsForTests();
});

afterEach(() => {
  resetTransactionalEmailGuardsForTests();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("sender defaults to service@ifcdc.org", () => {
  assert.equal(transactionalSenderEmail(), "service@ifcdc.org");
  assert.match(resolveTransactionalFromAddress(), /service@ifcdc\.org/);
});

test("Postmark is selected when the server token is set", async () => {
  const token = fakeCredential("pm-test");
  process.env.POSTMARK_SERVER_TOKEN = token;
  const calls = installFetch(async (url) => {
    if (url.includes("api.postmarkapp.com/email")) {
      return jsonResponse(200, { ErrorCode: 0, Message: "OK", MessageID: "pm-msg-1" });
    }
    throw new Error(`unexpected url ${url}`);
  }, token);
  try {
    const result = await sendTransactionalEmail({
      to: "member@example.com",
      subject: "Verify your IFCDC account",
      text: "Verification link",
      category: "account_verification",
    });
    assert.equal(result.success, true);
    assert.equal(result.provider, "postmark");
    assert.equal(result.provider.toUpperCase(), "POSTMARK");
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.from?.includes("service@ifcdc.org"), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.includes("api.postmarkapp.com/email"), true);
    assert.equal(calls[0].tokenMatched, true);
    assertNoTokenLeak(token, result.error, JSON.stringify(result.providerResponse || {}));
  } finally {
    calls.restore();
  }
});

test("Resend is used when the Postmark token is absent", async () => {
  const resendKey = fakeCredential("re-test");
  process.env.RESEND_API_KEY = resendKey;
  const calls = installFetch(async (url) => {
    if (url.includes("api.resend.com/domains")) {
      return jsonResponse(200, { data: [{ name: "ifcdc.org", status: "verified" }] });
    }
    if (url.includes("api.resend.com/emails")) {
      return jsonResponse(200, { id: "re-msg-1" });
    }
    throw new Error(`unexpected url ${url}`);
  }, "");
  try {
    const result = await sendTransactionalEmail({
      to: "member@example.com",
      subject: "Reset your IFCDC Headquarters password",
      text: "Reset link",
      category: "password_reset",
    });
    assert.equal(result.success, true);
    assert.equal(result.provider, "resend");
    assert.equal(result.provider.toUpperCase(), "RESEND");
    assert.equal(result.fallbackUsed, true);
    assert.equal(calls.some((call) => call.url.includes("api.postmarkapp.com")), false);
    assert.equal(calls.some((call) => call.url.includes("api.resend.com/emails")), true);
    assertNoTokenLeak(resendKey, result.error, JSON.stringify(result.providerResponse || {}));
  } finally {
    calls.restore();
  }
});

test("Resend fallback after a Postmark send failure records RESEND and fallbackUsed", async () => {
  const token = fakeCredential("pm-test");
  const resendKey = fakeCredential("re-test");
  process.env.POSTMARK_SERVER_TOKEN = token;
  process.env.RESEND_API_KEY = resendKey;
  const calls = installFetch(async (url) => {
    if (url.includes("api.postmarkapp.com/email")) {
      return jsonResponse(422, { ErrorCode: 10, Message: "Postmark rejected the message" });
    }
    if (url.includes("api.resend.com/domains")) {
      return jsonResponse(200, { data: [{ name: "ifcdc.org", status: "verified" }] });
    }
    if (url.includes("api.resend.com/emails")) {
      return jsonResponse(200, { id: "re-fallback-1" });
    }
    throw new Error(`unexpected url ${url}`);
  }, token);
  try {
    const result = await sendTransactionalEmail({
      to: "member@example.com",
      subject: "IFCDC HQ operational notice",
      text: "Operational notice body",
      category: "hq_operational",
    });
    assert.equal(result.success, true);
    assert.equal(result.provider.toUpperCase(), "RESEND");
    assert.equal(result.fallbackUsed, true);
    assert.equal(calls.some((call) => call.url.includes("api.postmarkapp.com/email")), true);
    assert.equal(calls.some((call) => call.url.includes("api.resend.com/emails")), true);
    assertNoTokenLeak(token, result.error, JSON.stringify(result.providerResponse || {}));
    assertNoTokenLeak(resendKey, result.error, JSON.stringify(result.providerResponse || {}));
  } finally {
    calls.restore();
  }
});

test("Resend failure does not fail transactional health when Postmark is healthy", async () => {
  const token = fakeCredential("pm-test");
  const resendKey = fakeCredential("re-test");
  process.env.POSTMARK_SERVER_TOKEN = token;
  process.env.RESEND_API_KEY = resendKey;
  const calls = installFetch(async (url) => {
    if (url.includes("api.postmarkapp.com/server")) {
      return jsonResponse(200, {
        Name: "IFCDC HQ",
        DeliveryType: "Live",
        ApiTokens: [token],
      });
    }
    if (url.includes("api.resend.com/domains")) {
      return jsonResponse(401, { message: `Resend rejected ${resendKey}` });
    }
    throw new Error(`unexpected url ${url}`);
  }, token);
  try {
    const probe = await probeTransactionalEmail();
    assert.equal(probe.ok, true);
    assert.equal(probe.provider, "postmark");
    assert.equal(probe.resend.ok, false);
    const findings = buildTransactionalEmailFindings(probe);
    const health = findings.find((finding) => finding.id === "transactional-email-health");
    assert.equal(health?.title, "Transactional Email Health");
    assert.equal(health?.status, "ok");
    assert.equal(findings.some((finding) => finding.status === "failed"), false);
    assert.equal(findings.some((finding) => finding.severity === "critical"), false);
    const note = findings.find((finding) => finding.id === "resend-fallback-note");
    assert.equal(note?.status, "ok");
    const serialized = JSON.stringify({ probe, findings });
    assertNoTokenLeak(token, serialized, probe.error, probe.postmark.error, probe.resend.error);
    assertNoTokenLeak(resendKey, serialized, probe.resend.error);
    assert.equal(serialized.includes("ApiTokens"), false);
  } finally {
    calls.restore();
  }
});

test("dedup and rate limit block a repeat send", async () => {
  const token = fakeCredential("pm-test");
  process.env.POSTMARK_SERVER_TOKEN = token;
  setTransactionalEmailLimitsForTests({ general: 1, security: 2 });
  let postmarkSends = 0;
  const calls = installFetch(async (url) => {
    if (url.includes("api.postmarkapp.com/email")) {
      postmarkSends += 1;
      return jsonResponse(200, { ErrorCode: 0, Message: "OK", MessageID: "pm-msg-dedupe" });
    }
    throw new Error(`unexpected url ${url}`);
  }, token);
  try {
    const first = await sendTransactionalEmail({
      to: "member@example.com",
      subject: "Booking confirmed",
      text: "Same booking body",
      category: "booking_confirmation",
    });
    const duplicate = await sendTransactionalEmail({
      to: "member@example.com",
      subject: "Booking confirmed",
      text: "Same booking body",
      category: "booking_confirmation",
    });
    const different = await sendTransactionalEmail({
      to: "member@example.com",
      subject: "Booking cancelled",
      text: "A different message",
      category: "booking_cancellation",
    });
    assert.equal(first.success, true);
    assert.equal(first.provider, "postmark");
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.deduped, true);
    assert.equal(different.success, false);
    assert.equal(different.rateLimited, true);
    assert.equal(postmarkSends, 1);
  } finally {
    calls.restore();
  }
});

test("token value is not present in error messages", async () => {
  const token = fakeCredential("pm-test");
  process.env.POSTMARK_SERVER_TOKEN = token;
  const leakedLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((arg) => String(arg)).join(" ");
    if (text.includes(token)) leakedLogs.push("log");
  };
  const calls = installFetch(async () => {
    return jsonResponse(422, { ErrorCode: 10, Message: `Invalid token ${token}` });
  }, token);
  try {
    const result = await sendTransactionalEmail({
      to: "founder@ifcdc.org",
      subject: "Security alert",
      text: "One-time code 000000",
      category: "security_alert",
    });
    assert.equal(result.success, false);
    assert.equal(result.provider, "postmark");
    assertNoTokenLeak(token, result.error, JSON.stringify(result.providerResponse || {}));
    assert.equal(redactEmailSecrets(`header ${token}`).includes(token), false);
    assert.equal(leakedLogs.length, 0);
  } finally {
    console.error = originalError;
    calls.restore();
  }
});

test("tests do not send live mail unless the mock transport is explicitly allowed", async () => {
  delete process.env.IFCDC_EMAIL_ALLOW_MOCK_TRANSPORT;
  const token = fakeCredential("pm-test");
  process.env.POSTMARK_SERVER_TOKEN = token;
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("live fetch blocked");
  }) as typeof fetch;
  try {
    const result = await sendTransactionalEmail({
      to: "member@example.com",
      subject: "Receipt",
      text: "Receipt body",
      category: "receipt",
    });
    assert.equal(result.suppressed, true);
    assert.equal(result.success, false);
    assert.equal(called, false);
    assertNoTokenLeak(token, result.error);
  } finally {
    globalThis.fetch = original;
  }
});
