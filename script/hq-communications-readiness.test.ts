import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { probeCommunicationsStorage } from "../server/hq/communicationsReadiness.ts";
import { ReadinessStatusBadge } from "../client/src/components/hq/ReadinessStatusBadge.tsx";

process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ifcdc-storage-readiness-"));
process.env.DATABASE_URL = "";
for (const key of ["OPENAI_API_KEY", "AURA_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "POSTMARK_SERVER_TOKEN", "RESEND_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) delete process.env[key];

const messages = `CREATE TABLE hq_messages (id TEXT, from_email TEXT, to_email TEXT, subject TEXT, body TEXT, channel TEXT, read_at TEXT, created_at TEXT)`;
const announcements = `CREATE TABLE hq_announcements (id TEXT, title TEXT, body TEXT, priority TEXT, status TEXT, published_at TEXT, created_at TEXT)`;

test("actual communications names pass even with no comm-prefixed table and empty message history", async () => {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    await db.exec(messages); await db.exec(announcements);
    assert.equal((await db.get("SELECT COUNT(*) as c FROM sqlite_master WHERE name LIKE 'comm%'")).c, 0);
    const p = await probeCommunicationsStorage(db);
    assert.equal(p.ok, true);
    assert.match(p.detail, /hq_messages and hq_announcements/);
    assert.equal((await db.get("SELECT COUNT(*) as c FROM hq_messages")).c, 0);
  } finally { await db.close(); }
});

test("missing required table is named precisely and no schema is created", async () => {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    await db.exec(messages);
    const p = await probeCommunicationsStorage(db);
    assert.equal(p.ok, false);
    assert.match(p.detail, /missing required table\(s\): hq_announcements/);
    assert.equal((await db.get("SELECT COUNT(*) as c FROM sqlite_master WHERE name = 'hq_announcements'")).c, 0);
  } finally { await db.close(); }
});

test("query failures and missing columns are not misreported as missing tables", async () => {
  await assert.rejects(probeCommunicationsStorage({ get: async () => { throw Error("database is locked"); } }), /locked/);
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    await db.exec("CREATE TABLE hq_messages (id TEXT)");
    await assert.rejects(probeCommunicationsStorage(db), /no such column/);
  } finally { await db.close(); }
});

test("actual readiness badges render visible severity and evidence status labels", () => {
  for (const [status, label, variant] of [["high", "HIGH", "danger"], ["pending_manual", "UNVERIFIED", "warning"], ["not_certified", "NOT CERTIFIED", "warning"], ["pass", "PASS", "success"]]) {
    const html = renderToStaticMarkup(React.createElement(ReadinessStatusBadge, { status }));
    assert.match(html, new RegExp(`>${label}<`));
    assert.match(html, new RegExp(`hq-badge ${variant}`));
  }
});

test("actual assessment tests real communications schema; dashboard excludes historical findings without deleting them", async () => {
  const { getDb } = await import("../server/db.ts");
  const db = await getDb();
  await db.exec(messages); await db.exec(announcements);
  const engine = await import("../server/hq/enterpriseReadinessCertificationEngine.ts");
  const first = await engine.runEnterpriseReadinessCertification({ liveIntegrations: false });
  const communications = first.checks.find((c) => c.id === "mod-communications");
  assert.equal(communications?.status, "pending_manual");
  assert.match(communications?.detail ?? "", /hq_messages and hq_announcements/);
  assert.doesNotMatch(communications?.detail ?? "", /tables missing/);
  const second = await engine.runEnterpriseReadinessCertification({ liveIntegrations: false });
  // Unique timestamps guarantee the test selects this newest run even on coarse clocks.
  await db.run("UPDATE aura_erc_runs SET completed_at = ? WHERE id = ?", "2099-01-01T00:00:00Z", second.id);
  const dash = await engine.buildEnterpriseReadinessDashboard();
  assert.equal(dash.latest?.id, second.id);
  const currentIds = new Set(second.issues.map((i) => i.id));
  assert.ok(dash.openIssues.every((i) => currentIds.has(i.id)));
  assert.ok((await engine.listCertificationIssues({ runId: first.id })).length > 0);
  for (const issue of second.issues) await engine.updateCertificationIssueStatus({ id: issue.id, status: "resolved" });
  const reviewed = await engine.buildEnterpriseReadinessDashboard();
  assert.equal(reviewed.openIssues.length, 0);
  assert.equal(reviewed.latest?.outstandingIssueCount, 0);
  assert.match(reviewed.latest?.speechSummary ?? "", /0 current open findings/);
  assert.ok(reviewed.latest?.issues.every((i) => i.status === "resolved"));
  assert.equal(reviewed.certified, false, "reviewing issue status must not certify incomplete checks");
});
