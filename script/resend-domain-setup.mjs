#!/usr/bin/env node
/**
 * Register/verify ifcdc.org in Resend and print GoDaddy DNS records.
 * Uses RESEND_API_KEY from env (local or after Render shell export).
 *
 *   RESEND_API_KEY=re_… node script/resend-domain-setup.mjs
 *   RESEND_API_KEY=re_… node script/resend-domain-setup.mjs --verify
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadDotEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotEnv();

const DOMAIN = (process.env.RESEND_DOMAIN || "ifcdc.org").toLowerCase();
const KEY = (process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY || "").trim();
const DO_VERIFY = process.argv.includes("--verify");

async function api(path, init = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log(`\n=== Resend domain setup: ${DOMAIN} ===\n`);
  if (!KEY) {
    console.error("Set RESEND_API_KEY (same value as Render ifcdc-hq)");
    process.exit(1);
  }

  const list = await api("/domains");
  if (!list.ok) {
    console.error("List domains failed:", list.status, list.data);
    process.exit(1);
  }
  let domains = list.data.data || [];
  console.log("Existing domains:", domains.map((d) => `${d.name}(${d.status})`).join(", ") || "(none)");

  let match = domains.find((d) => (d.name || "").toLowerCase() === DOMAIN);
  if (!match) {
    console.log(`Creating domain ${DOMAIN}…`);
    const created = await api("/domains", { method: "POST", body: JSON.stringify({ name: DOMAIN }) });
    if (!created.ok) {
      console.error("Create failed:", created.status, created.data);
      process.exit(1);
    }
    match = { id: created.data.id, name: created.data.name, status: created.data.status };
    console.log("Created:", match.id, match.status);
  } else {
    console.log("Already registered:", match.id, match.status);
  }

  const detail = await api(`/domains/${match.id}`);
  const records = detail.data.records || [];
  console.log("\n--- Publish these DNS records at GoDaddy (ifcdc.org) ---\n");
  for (const r of records) {
    console.log(`${r.record || r.type}\t${r.type}\t${r.name}\t${r.value}\tstatus=${r.status || "?"}`);
  }
  console.log("\nRecommended DMARC TXT _dmarc:");
  console.log('TXT\t_dmarc\tv=DMARC1; p=none; rua=mailto:service@ifcdc.org');

  if (DO_VERIFY) {
    console.log("\nRequesting Resend verify…");
    const v = await api(`/domains/${match.id}/verify`, { method: "POST" });
    console.log(v.ok ? "Verify accepted" : "Verify response", v.status, v.data);
    const again = await api(`/domains/${match.id}`);
    console.log("Status now:", again.data.status);
  } else {
    console.log("\nAfter DNS is saved, re-run with --verify");
  }

  console.log("\nThen on Render set:");
  console.log(`  RESEND_FROM_EMAIL=IFCDC Headquarters <service@${DOMAIN}>`);
  console.log("Manual Deploy, then: node script/email-engine-e2e.mjs\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
