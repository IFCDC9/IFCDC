import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "grant-review-auth-"));
process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = dir;
process.env.DATABASE_URL = "";
process.env.IFCDC_GRANTS_QA = "1";
process.env.ALLOW_DEMO_SEED = "false";
const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { JWT_SECRET } = await import("../server/config/auth");
const { default: router } = await import("../server/routes/grants.routes");
const { getDb } = await import("../server/db");
const app = express(); app.use(express.json()); app.use("/grants", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/grants`;
const request = (endpoint: string, role: string, body?: unknown) => fetch(`${url}${endpoint}`, { method: body ? "PUT" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ id: role, role, email: `${role}@example.test` }, JWT_SECRET)}` }, body: body ? JSON.stringify(body) : undefined });
test.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await (await getDb()).close(); rmSync(dir, { recursive: true, force: true }); });

test("only Founder can verify facts or notice conditions; staff may read existing review status", async () => {
  const facts = ["legalName", "taxStatus", "serviceArea", "programs"].map((key) => ({ key, value: key === "legalName" ? "Imperial Foundation Community Development Center" : "Documented fact", sourceRef: "vault:document" }));
  assert.equal((await request("/verified-profile", "admin", { facts })).status, 403);
  assert.equal((await request("/opportunities/missing/eligibility-review", "admin", {})).status, 403);
  const saved = await request("/verified-profile", "owner", { facts });
  assert.equal(saved.status, 200, await saved.text());
  const read = await request("/verified-profile", "admin");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).profile.facts.length, 4);
});
