#!/usr/bin/env node
/**
 * After Manual Deploy: poll production email status until ifcdc.org is registered
 * and print GoDaddy DNS records from domainSetup.
 *
 *   node script/resend-poll-domain-status.mjs
 */
const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const maxAttempts = Number(process.env.POLL_ATTEMPTS || 20);
const delayMs = Number(process.env.POLL_MS || 15_000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\nPolling ${BASE}/api/hq/email/status for domainSetup…\n`);
  for (let i = 1; i <= maxAttempts; i++) {
    const res = await fetch(`${BASE}/api/hq/email/status`, { signal: AbortSignal.timeout(30_000) });
    const j = await res.json().catch(() => ({}));
    const ds = j.domainSetup;
    const auth = j.senderAuth || {};
    console.log(
      `[${i}/${maxAttempts}] hasDomainSetup=${Boolean(ds)} verified=${ds?.verified} fallback=${ds?.usedFallback ?? auth.usedFallback} domains=${(j.resendProbe?.domains || []).map((d) => d.name).join(",") || "?"}`,
    );
    if (ds && !ds.error) {
      console.log(`\nTarget: ${ds.targetDomain} · registered=${ds.registered} · status=${ds.status}`);
      console.log(`From configured: ${ds.fromConfigured}`);
      console.log(`From effective:  ${ds.fromEffective}`);
      console.log(`\n--- GoDaddy DNS records ---\n`);
      for (const r of ds.records || []) {
        console.log(`${r.type}\t${r.name}\t${r.value}\t(${r.record || ""} status=${r.status || "?"})`);
      }
      if (ds.guidance?.length) {
        console.log("\nGuidance:");
        for (const g of ds.guidance) console.log(`  - ${g}`);
      }
      if (ds.verified && !ds.usedFallback) {
        console.log("\n✓ ifcdc.org verified and fallback off — Resend should report Connected.\n");
        process.exit(0);
      }
      if (!ds.verified && (ds.records || []).length) {
        console.log("\n→ Add the records above in GoDaddy, wait for DNS, then verify.\n");
        process.exit(2);
      }
    } else if (ds?.error) {
      console.log(`\n✗ domainSetup.error: ${ds.error}`);
      if (/plan includes 1 domain|upgrade to add more/i.test(ds.error)) {
        console.log(
          "\n→ Resend free plan allows 1 domain. Deploy the domain-replace build, then re-poll.\n" +
            "  HQ will swap ifcdcbarbersapp.com → ifcdc.org (or upgrade Resend to Pro).\n",
        );
        process.exit(3);
      }
    }
    if (i < maxAttempts) await sleep(delayMs);
  }
  console.error("\nTimed out waiting for domainSetup (deploy may not include resendDomainEngine yet).\n");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
