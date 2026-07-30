#!/usr/bin/env node
/**
 * Phase 1 — Executive Email Readiness audit
 *
 * Local dry-render + production Founder-inbox probes via live-send / run-matrix.
 *
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com node script/email-readiness-audit.mjs
 *   IFCDC_BASE_URL=http://127.0.0.1:5001 node script/email-readiness-audit.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const TO = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const __dirname = dirname(fileURLToPath(import.meta.url));

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { res, json, ok: res.ok, status: res.status };
}

async function main() {
  console.log(`\n=== Email Readiness Audit ===\n${BASE}\n`);
  const rows = [];

  const status = await api("/api/hq/email/status?compact=1");
  rows.push({
    name: "Transport / sender health",
    result: status.json?.resendProbe?.ok && status.json?.senderAuth?.usedFallback === false ? "PASS" : "FAIL",
    route: "GET /api/hq/email/status",
    sender: status.json?.senderAuth?.from || status.json?.from,
    recipient: null,
    template: null,
    http: status.status,
    messageId: null,
    delivery: status.json?.resendProbe?.ok ? "probe_ok" : "probe_fail",
    warnings: status.json?.senderAuth?.usedFallback ? ["fallback active"] : [],
  });

  let readiness = await api("/api/hq/email/readiness");
  if (!readiness.ok) {
    console.log("GET /email/readiness not deployed yet — continuing with live-send probes only");
  } else {
    const dry = readiness.json?.report?.templateDryRender || [];
    for (const t of dry) {
      rows.push({
        name: `Dry-render ${t.templateId}`,
        result: t.ok ? "PASS" : "FAIL",
        route: "GET /api/hq/email/readiness",
        sender: readiness.json?.report?.sender?.effective,
        recipient: null,
        template: t.templateId,
        http: 200,
        messageId: null,
        delivery: "n/a_dry_render",
        warnings: [],
        error: t.error,
      });
    }
  }

  // Prefer full matrix if deployed
  const matrix = await api("/api/hq/email/readiness/run-matrix", {
    method: "POST",
    body: { to: TO },
  });
  if (matrix.ok && Array.isArray(matrix.json?.lastResults)) {
    console.log(`run-matrix OK — ${matrix.json.matrix?.sent || 0} sent`);
    for (const r of matrix.json.lastResults) {
      rows.push({
        name: r.name,
        result: r.result,
        route: r.route,
        sender: r.sender,
        recipient: r.recipient,
        template: r.template,
        http: r.httpStatus,
        messageId: r.messageId,
        delivery: r.deliveryStatus,
        warnings: r.warnings || [],
        security: r.securityObservations || [],
        error: r.error,
      });
    }
  } else {
    console.log(`run-matrix unavailable (${matrix.status}) — using live-send probes`);
    const probes = [
      ["AURA / live-send", "Email Readiness — aura_live_send"],
      ["Founder security path", "Email Readiness — founder_security_probe"],
      ["Executive alert path", "Email Readiness — executive_alert_probe"],
    ];
    for (const [name, subject] of probes) {
      const send = await api("/api/hq/email/live-send", {
        method: "POST",
        body: {
          to: TO,
          subject,
          body:
            `Hello Mr. Allah,\n\nEmail Readiness audit probe: ${name}.\n\n`
            + `Sender must be service@ifcdc.org.\n\n— AURA\nIFCDC HQ`,
        },
      });
      rows.push({
        name,
        result: send.json?.success ? "PASS" : "FAIL",
        route: "POST /api/hq/email/live-send",
        sender: send.json?.from,
        recipient: send.json?.to || TO,
        template: "executive_alert (via sendFounderSecurityEmail)",
        http: send.status,
        messageId: send.json?.messageId,
        delivery: send.json?.success ? "accepted" : "failed",
        warnings: send.json?.usedFallback ? ["fallback"] : [],
        error: send.json?.error,
      });
      await new Promise((r) => setTimeout(r, 800));
    }

    // Document not configured without sending
    for (const name of [
      "Email verification",
      "Password-reset confirmation",
      "Booking cancellation",
      "Booking reschedule",
      "HR hiring email",
    ]) {
      rows.push({
        name,
        result: "NOT_CONFIGURED",
        route: "(none)",
        sender: null,
        recipient: null,
        template: null,
        http: null,
        messageId: null,
        delivery: "not_configured",
        warnings: ["No Resend caller in HQ codebase"],
      });
    }
  }

  const outDir = resolve(__dirname, "../Documents/products");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "EMAIL-READINESS-AUDIT.json");
  const payload = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    to: TO,
    rows,
    summary: {
      pass: rows.filter((r) => r.result === "PASS").length,
      fail: rows.filter((r) => r.result === "FAIL").length,
      notConfigured: rows.filter((r) => r.result === "NOT_CONFIGURED").length,
    },
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(JSON.stringify(payload.summary, null, 2));
  for (const r of rows) {
    console.log(`${r.result.padEnd(14)} ${r.name} mid=${r.messageId || "—"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
