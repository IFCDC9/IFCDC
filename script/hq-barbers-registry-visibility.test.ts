/**
 * Barbers can be visible in hq_registered_apps while production protection stays locked.
 * Uses a temporary sqlite file. No network, no mail, no unlock.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "ifcdc-hq-registry-"));
process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = dataDir;
process.env.HQ_BARBERS_HEALTH_URL = "http://127.0.0.1:9/api/health";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("registry visibility test must not poll the network");
}) as typeof fetch;

test("barbers is registered for visibility while production protection stays locked", async () => {
  const { getDbPath } = await import("../server/config/dataPaths.ts");
  assert.equal(getDbPath().startsWith(dataDir), true);

  const schema = await import("../server/hq/softwareDivisionSchema.ts");
  const { SOFTWARE_DIVISION_APPS, getSoftwareDivisionApps } = await import("../server/hq/appRegistry.ts");

  await schema.ensureSoftwareDivisionTables();
  await schema.ensureProductionLockedRegistryVisibility();

  const registered = await schema.listRegisteredApps();
  assert.equal(registered.length, 1);
  assert.equal(registered[0]?.id, "barbers");
  assert.equal(registered[0]?.status, "locked");
  assert.equal(registered[0]?.health_url, "http://127.0.0.1:9/api/health");
  assert.equal(registered[0]?.api_key_prefix, "locked");
  assert.equal(await schema.verifyAppApiKey("barbers", "ifcdc_barbers_not-a-real-key"), false);

  const catalog = SOFTWARE_DIVISION_APPS.find((app) => app.id === "barbers");
  assert.equal(catalog?.locked, true);
  assert.equal(catalog?.status, "locked");

  const registry = await getSoftwareDivisionApps();
  const registeredIds = new Set(registered.map((row) => row.id));
  const visible = registry.map((app) => ({
    id: app.id,
    locked: app.locked === true,
    status: app.status,
    registered: registeredIds.has(app.id),
  }));
  const barbers = visible.find((app) => app.id === "barbers");
  assert.deepEqual(barbers, { id: "barbers", locked: true, status: "locked", registered: true });
  assert.equal(visible.filter((app) => app.registered).length, 1);
  assert.equal(visible.filter((app) => app.id !== "barbers" && app.registered).length, 0);
  assert.equal(SOFTWARE_DIVISION_APPS.filter((app) => app.locked).map((app) => app.id).join(","), "barbers");

  await assert.rejects(
    () => schema.registerSoftwareApp({ id: "barbers", name: "IFCDC Barbers App", healthUrl: "http://127.0.0.1:9/api/health" }),
    /production locked/,
  );
  await assert.rejects(() => schema.updateSoftwareApp("barbers", { name: "Unlocked Barbers" }), /production locked/);
  await assert.rejects(() => schema.deleteSoftwareApp("barbers"), /production locked/);
  await assert.rejects(() => schema.rotateAppApiKey("barbers"), /production locked/);

  const afterWrites = await schema.listRegisteredApps();
  assert.equal(afterWrites.length, 1);
  assert.equal(afterWrites[0]?.id, "barbers");
  assert.equal(SOFTWARE_DIVISION_APPS.find((app) => app.id === "barbers")?.locked, true);
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
