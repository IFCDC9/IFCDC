import assert from "node:assert/strict";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { preserveVerifiedGrantDetail } from "../server/hq/grantFeedConnectors.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
delete process.env.IFCDC_GRANT_DETAIL_FILL;
delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;

const DETAIL = "Public or private nonprofit organizations, including 501(c)(3) organizations.";

async function memoryDb() {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await db.exec(`CREATE TABLE grant_opportunities (
    id TEXT PRIMARY KEY,
    external_id TEXT,
    eligibility TEXT,
    award_ceiling REAL,
    award_floor REAL,
    estimated_funding REAL,
    deadline TEXT,
    close_date TEXT,
    updated_at TEXT,
    status TEXT,
    funder TEXT,
    url TEXT,
    amount_min REAL,
    amount_max REAL
  )`);
  return db;
}

test("a placeholder feed row keeps stored eligibility, amounts, and calendar deadline", async () => {
  const db = await memoryDb();
  await db.run(
    `INSERT INTO grant_opportunities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "row-1", "346815", DETAIL, 30_000_000, 100_000, 5_000_000, "2026-12-01", "2026-12-01",
    "2026-10-10T11:33:27.003Z", "open", "Economic Development Administration",
    "https://www.grants.gov/search-results-detail/346815", null, null,
  );
  await db.run(
    `INSERT INTO grant_opportunities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "ed163a6d-94db-44a9-9135-17ccd504f7f4", "351547", DETAIL, 3_000_000, 100_000, 40_000_000,
    "2029-12-31", "2029-12-31", "2026-10-10T11:33:27.003Z", "open", "Denali Commission",
    "https://www.grants.gov/search-results-detail/351547", null, null,
  );

  const stored = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", "row-1");
  const preserved = preserveVerifiedGrantDetail(stored, {
    external_id: "346815",
    eligibility: "See opportunity listing",
    award_floor: null,
    award_ceiling: null,
    estimated_funding: null,
    amount_min: null,
    amount_max: null,
    deadline: "",
    close_date: "rolling",
  });
  assert.equal(preserved.eligibility, DETAIL);
  assert.equal(preserved.awardCeiling, null);
  assert.equal(preserved.awardFloor, null);
  assert.equal(preserved.estimatedFunding, null);
  assert.equal(preserved.deadline, null);

  await db.run(
    `UPDATE grant_opportunities SET
       award_floor = COALESCE(?, award_floor),
       award_ceiling = COALESCE(?, award_ceiling),
       estimated_funding = COALESCE(?, estimated_funding),
       deadline = COALESCE(?, deadline),
       close_date = COALESCE(?, close_date),
       eligibility = ?
     WHERE id = ?`,
    preserved.awardFloor,
    preserved.awardCeiling,
    preserved.estimatedFunding,
    preserved.deadline,
    preserved.deadline,
    preserved.eligibility,
    "row-1",
  );
  const kept = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", "row-1");
  assert.equal(kept.eligibility, DETAIL);
  assert.equal(kept.award_ceiling, 30_000_000);
  assert.equal(kept.award_floor, 100_000);
  assert.equal(kept.estimated_funding, 5_000_000);
  assert.equal(kept.deadline, "2026-12-01");
  assert.equal(kept.status, "open");
  assert.equal(kept.funder, "Economic Development Administration");
  assert.equal(kept.updated_at, "2026-10-10T11:33:27.003Z");

  const alaska = await db.get("SELECT * FROM grant_opportunities WHERE external_id = ?", "351547");
  const alaskaKept = preserveVerifiedGrantDetail(alaska, {
    external_id: "351547",
    eligibility: "See opportunity listing",
    award_ceiling: 8_000_000,
    estimated_funding: 80_000_000,
    award_floor: null,
    amount_min: null,
    amount_max: 8_000_000,
    deadline: null,
    close_date: null,
  });
  assert.equal(alaskaKept.awardCeiling, null);
  assert.equal(alaskaKept.estimatedFunding, null);
  await db.run(
    `UPDATE grant_opportunities SET award_ceiling = COALESCE(?, award_ceiling), estimated_funding = COALESCE(?, estimated_funding), eligibility = ? WHERE id = ?`,
    alaskaKept.awardCeiling,
    alaskaKept.estimatedFunding,
    alaskaKept.eligibility,
    alaska.id,
  );
  const alaskaRow = await db.get("SELECT award_ceiling, estimated_funding, eligibility FROM grant_opportunities WHERE id = ?", alaska.id);
  assert.equal(alaskaRow.award_ceiling, 3_000_000);
  assert.equal(alaskaRow.estimated_funding, 40_000_000);
  assert.equal(alaskaRow.eligibility, DETAIL);

  const realUpdate = preserveVerifiedGrantDetail(stored, {
    external_id: "346815",
    eligibility: "Nonprofit organizations with 501(c)(3) status may apply for this program.",
    award_floor: 250_000,
    award_ceiling: 40_000_000,
    estimated_funding: 12_000_000,
    amount_min: null,
    amount_max: null,
    deadline: "2027-03-01",
    close_date: null,
  });
  assert.equal(realUpdate.eligibility, "Nonprofit organizations with 501(c)(3) status may apply for this program.");
  assert.equal(realUpdate.awardFloor, 250_000);
  assert.equal(realUpdate.awardCeiling, 40_000_000);
  assert.equal(realUpdate.estimatedFunding, 12_000_000);
  assert.equal(realUpdate.deadline, "2027-03-01");
  await db.run(
    `UPDATE grant_opportunities SET
       award_floor = COALESCE(?, award_floor),
       award_ceiling = COALESCE(?, award_ceiling),
       estimated_funding = COALESCE(?, estimated_funding),
       deadline = COALESCE(?, deadline),
       eligibility = ?
     WHERE id = ?`,
    realUpdate.awardFloor,
    realUpdate.awardCeiling,
    realUpdate.estimatedFunding,
    realUpdate.deadline,
    realUpdate.eligibility,
    "row-1",
  );
  const updated = await db.get("SELECT eligibility, award_floor, award_ceiling, estimated_funding, deadline, status, funder, url, amount_min, amount_max FROM grant_opportunities WHERE id = ?", "row-1");
  assert.equal(updated.eligibility, realUpdate.eligibility);
  assert.equal(updated.award_floor, 250_000);
  assert.equal(updated.award_ceiling, 40_000_000);
  assert.equal(updated.estimated_funding, 12_000_000);
  assert.equal(updated.deadline, "2027-03-01");
  assert.equal(updated.status, "open");
  assert.equal(updated.funder, "Economic Development Administration");
  assert.equal(updated.url, "https://www.grants.gov/search-results-detail/346815");
  assert.equal(updated.amount_min, null);
  assert.equal(updated.amount_max, null);
  await db.close();
});
