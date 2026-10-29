/** Assessment probes must never invoke connection repair, sends, or transactions. */
export type ReadinessProbe = { success: boolean; pending?: boolean; message: string };

// Only these legacy module callbacks have been reviewed as configuration/schema reads.
const READ_ONLY_MODULES = new Set([
  "mod-aura-chat", "mod-aura-voice", "mod-founder-mode", "mod-communications",
  "mod-grants", "mod-grant-writer", "mod-documents", "mod-finance",
  "mod-mission-control", "mod-enterprise-brain", "mod-reporting", "mod-notifications",
]);

export async function runReadOnlyModuleProbe(p: {
  id: string;
  probe: () => Promise<{ ok: boolean; detail: string; warn?: boolean; unscored?: boolean }>;
}): Promise<{ ok: boolean; detail: string; warn?: boolean; unscored?: boolean }> {
  if (!READ_ONLY_MODULES.has(p.id)) {
    return { ok: true, unscored: true, detail: "UNVERIFIED: combined operational builder not run during assessment. Inspect this module separately and record its acceptance test." };
  }
  const result = await p.probe();
  return result.ok
    ? { ...result, unscored: true, detail: `${result.detail}. Configuration/schema evidence only; end-to-end behavior remains UNVERIFIED.` }
    : result;
}

export type ReadinessProbeReaders = {
  openai: () => Promise<{ ok: boolean }>;
  twilio: () => Promise<{ healthy: boolean; phone: { found: boolean } }>;
  email: () => Promise<{ ok: boolean; provider: string }>;
  paypal: () => Promise<{ authenticated: boolean }>;
  database: () => Promise<unknown>;
};

const readers: ReadinessProbeReaders = {
  openai: async () => (await import("../lib/openaiConfig")).verifyOpenAiConnection(),
  // Direct GET-only probe. Do not use testTwilioIntegrationLive (it syncs webhooks).
  twilio: async () => (await import("./twilioIntegrationEngine")).probeTwilioApi(),
  email: async () => (await import("../lib/transactionalEmail")).probeTransactionalEmail(),
  // OAuth verification only. No checkout order is created.
  paypal: async () => (await import("./paypalIntegrationEngine")).probePayPalAuthentication(),
  database: async () => (await (await import("../db")).getDb()).get("SELECT 1 as ok"),
};

export async function testReadOnlyIntegrationProvider(
  provider: string, read: ReadinessProbeReaders = readers,
): Promise<ReadinessProbe> {
  // Responses deliberately omit keys, tokens, private phone numbers, and webhook URLs.
  switch (provider) {
    case "openai_aura": {
      const p = await read.openai();
      return { success: p.ok, message: p.ok ? "OpenAI models API responded. Conversation quality and tool execution remain UNVERIFIED." : "OpenAI authentication/connectivity probe failed; inspect its configuration separately." };
    }
    case "twilio": {
      const p = await read.twilio();
      return { success: p.healthy, message: p.healthy ? "Twilio account and phone routing checks passed. No webhooks changed; real call/SMS flow remains UNVERIFIED." : `Twilio read-only check failed (${p.phone.found ? "phone found; review configuration/routing" : "phone not verified"}). No webhooks changed.` };
    }
    case "transactional_email": {
      const p = await read.email();
      return { success: p.ok, message: p.ok ? `${p.provider} server probe passed. No email sent; inbox delivery remains UNVERIFIED.` : "Configured transactional email probe failed. No email sent; inspect Postmark/Resend configuration." };
    }
    case "paypal": {
      const p = await read.paypal();
      return { success: p.authenticated, pending: p.authenticated, message: p.authenticated ? "PayPal OAuth verified. Checkout, capture and refunds UNVERIFIED: no order created or funds moved." : "PayPal OAuth could not be verified. No order created or funds moved." };
    }
    case "postgres": {
      await read.database();
      return { success: true, message: "Database SELECT 1 succeeded. Backup integrity and restore recovery remain UNVERIFIED." };
    }
    default:
      return { success: false, pending: true, message: `UNVERIFIED: ${provider} has no reviewed read-only probe in this assessment. No operational test or repair was run.` };
  }
}

export const REQUIRED_ACCEPTANCE_TESTS = [
  { id: "grants", label: "Grants workflow", path: "/hq/grants", test: "Trace a real opportunity through eligibility, proposal, budget, Founder review and submission readiness. Do not submit while assessing." },
  { id: "backup", label: "Backup and restore", path: "/hq/security", test: "Record the last successful backup, destination, next scheduled run, and a successful restore into an isolated environment." },
  { id: "memory", label: "Aura memory", path: "/hq/aura", test: "Retrieve an approved known fact with its source, then verify tenant and role isolation." },
  { id: "engineering", label: "Engineering tools", path: "/hq/software-engineering", test: "Verify the runner, reviewed change package and controlled tests against an exact commit. Production deployment requires separate Founder approval." },
  { id: "permissions", label: "Permissions", path: "/hq/security", test: "Verify server-side allowed and denied operations with representative roles; configuration alone does not prove access isolation." },
  { id: "notifications", label: "Notification delivery", path: "/hq/notifications", test: "Verify an intentionally authorized event reaches the correct recipient and record provider acceptance separately from delivery." },
  { id: "apps", label: "Application flows", path: "/hq/software-engineering", test: "Verify deployed app endpoints and main user flows; distinguish undeployed apps and missing monitor configuration from confirmed outages." },
] as const;
