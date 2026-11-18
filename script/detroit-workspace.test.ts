import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DETROIT_AURA_LIVE_SEARCH,
  DETROIT_FIELDS,
  DETROIT_RECORD_TYPES,
  extractDetroitDrafts,
  fingerprintRecord,
  grantCenterResearchPayload,
  isDetroitRelatedGrant,
  planDetroitImport,
  scanBrowserStorage,
} from "../shared/detroitWorkspace";

const dir = mkdtempSync(path.join(tmpdir(), "detroit-workspace-"));
process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = dir;
process.env.DATABASE_URL = "";
process.env.IFCDC_GRANTS_QA = "1";
process.env.ALLOW_DEMO_SEED = "false";

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { JWT_SECRET } = await import("../server/config/auth");
const { default: router } = await import("../server/routes/detroit-workspace.routes");
const { getDb } = await import("../server/db");

const app = express();
app.use(express.json());
app.use("/detroit-workspace", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/detroit-workspace`;
const token = jwt.sign({ id: "owner", role: "owner", email: "owner@example.test" }, JWT_SECRET);
const staff = jwt.sign({ id: "staff", role: "barber", email: "staff@example.test" }, JWT_SECRET);
const call = (endpoint: string, method = "GET", body?: unknown, auth = token) =>
  fetch(`${url}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await (await getDb()).close();
  rmSync(dir, { recursive: true, force: true });
});

test("nine work areas have fields and import never overwrites HQ records", () => {
  assert.equal(DETROIT_RECORD_TYPES.length, 9);
  for (const type of DETROIT_RECORD_TYPES) assert.ok(DETROIT_FIELDS[type].length >= 4);
  assert.equal(DETROIT_AURA_LIVE_SEARCH, false);
  const existing = [{ type: "property", title: "123 Main", sourceUrl: "https://example.test/a", payload: { address: "123 Main" } }];
  const plan = planDetroitImport(existing, [
    { type: "property", title: "123 Main", sourceUrl: "https://example.test/a", payload: { address: "123 Main", notes: "newer notes" } },
    { type: "contact", title: "Block club", payload: { name: "Unknown until verified" } },
    { type: "property", title: "", payload: {} },
  ]);
  assert.equal(plan.toInsert.length, 1);
  assert.equal(plan.skippedDuplicates.length, 1);
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.toInsert[0].type, "contact");
  assert.equal(
    fingerprintRecord({ type: "property", title: "123 Main", sourceUrl: "https://example.test/a", payload: { address: "123 Main" } }),
    fingerprintRecord(existing[0]),
  );
});

test("pasted JSON extraction and grant matching stay conservative", () => {
  const storage = {
    keys: ["ifcdc-detroit-site", "unrelated", "dlba-lots"],
    values: {
      "ifcdc-detroit-site": JSON.stringify({ properties: [{ title: "Vacant lot", address: "Unknown" }] }),
      unrelated: JSON.stringify({ title: "ignore" }),
      "dlba-lots": "not-json",
    },
    length: 3,
    key(index: number) { return this.keys[index] ?? null; },
    getItem(key: string) { return this.values[key as keyof typeof this.values] ?? null; },
  };
  const scanned = scanBrowserStorage(storage);
  assert.deepEqual(scanned.matchedKeys, ["ifcdc-detroit-site", "dlba-lots"]);
  assert.equal(scanned.drafts.length, 1);
  assert.equal(scanned.drafts[0].title, "Vacant lot");
  assert.equal(extractDetroitDrafts({ records: [] }).length, 0);
  assert.equal(extractDetroitDrafts({
    records: [
      { type: "property", title: "Pasted lot", payload: { address: "Unknown" } },
    ],
  }).length, 1);
  assert.equal(isDetroitRelatedGrant({ title: "Community facility", funder: "Example" }), false);
  assert.equal(isDetroitRelatedGrant({ title: "Detroit land reuse", funder: "DLBA" }), true);
  assert.equal(grantCenterResearchPayload({ title: "CDBG", payload: {} }), null);
  const research = grantCenterResearchPayload({ title: "CDBG", payload: { funder: "City of Detroit", notes: "Check source" } });
  assert.equal(research?.eligibility, "Unknown");
  assert.match(research?.description || "", /not running a live Detroit grant search/);
});

test("authenticated HQ API creates, edits, and imports without overwrite", async () => {
  assert.equal((await call("/records", "GET", undefined, "")).status, 401);
  assert.equal((await call("/records", "GET", undefined, staff)).status, 403);
  const created = await call("/records", "POST", {
    type: "property",
    title: "Example DLBA lot",
    status: "Researching",
    verificationStatus: "Unknown",
    sourceUrl: "https://buildingdetroit.org/example",
    payload: { address: "Example DLBA lot", askingPrice: "" },
  });
  const createdBody = await created.json() as { record?: { id: string; payload: Record<string, string> }; error?: string };
  assert.equal(created.status, 201, createdBody.error || "create failed");
  const { record } = createdBody as { record: { id: string; payload: Record<string, string> } };
  assert.equal(record.payload.address, "Example DLBA lot");
  const patched = await call(`/records/${record.id}`, "PATCH", { title: "Example DLBA lot", payload: { address: "Example DLBA lot", notes: "Visit needed" } });
  assert.equal(patched.status, 200);
  const imported = await call("/records/import", "POST", {
    source: "detroit-site-export",
    records: [
      { type: "property", title: "Example DLBA lot", sourceUrl: "https://buildingdetroit.org/example", payload: { address: "Example DLBA lot" } },
      { type: "follow_up", title: "Call assessor", payload: { action: "Confirm parcel id" } },
    ],
  });
  assert.equal(imported.status, 201);
  const report = await imported.json() as { imported: number; skippedDuplicates: number };
  assert.equal(report.imported, 1);
  assert.equal(report.skippedDuplicates, 1);
  const listed = await (await call("/records")).json() as { records: { title: string }[] };
  assert.equal(listed.records.length, 2);
});

test("HQ page keeps edit actions visible and does not claim live Aura search", () => {
  const page = readFileSync(new URL("../client/src/pages/hq/DetroitWorkspacePage.tsx", import.meta.url), "utf8");
  assert.match(page, /Update shared record/);
  assert.match(page, /Export a backup from the Detroit Site/);
  assert.match(page, /Import pasted JSON/);
  assert.match(page, /duplicates are skipped/);
  assert.match(page, /Open Grant Center/);
  assert.match(page, /Aura is not running a live Detroit grant search/);
  assert.doesNotMatch(page, /Scan this browser/);
  assert.doesNotMatch(page, /scanned Site/i);
  assert.doesNotMatch(page, /scanBrowserStorage/);
  assert.equal(page.includes(":hover"), false);
});
