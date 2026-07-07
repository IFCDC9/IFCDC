import { getDb } from "../db";
import { allowHqDemoSeed } from "./grantProductionPolicy";

/**
 * Remove known HQ sample/boot records from production SQLite.
 * Safe to run repeatedly — only deletes identifiable demo signatures.
 */
export async function purgeHqSampleData(): Promise<Record<string, number>> {
  if (allowHqDemoSeed()) {
    return { financeInvoices: 0, financeVendors: 0, housingUnits: 0, assets: 0, fleet: 0, events: 0 };
  }

  const db = await getDb();
  const counts: Record<string, number> = {};

  const inv = await db.run(
    `DELETE FROM finance_invoices WHERE invoice_number IN ('AP-2026-001','AP-2026-002','AR-2026-001','AR-2026-002')`
  );
  counts.financeInvoices = inv.changes ?? 0;

  const vendors = await db.run(
    `DELETE FROM finance_vendors WHERE name IN (
      'Atlantic Office Supply', 'NJ Electric & Gas', 'CloudHost Pro', 'Community Print Works'
    )`
  );
  counts.financeVendors = vendors.changes ?? 0;

  const housing = await db.run(`DELETE FROM housing_units WHERE address LIKE '1240 Community Way%'`);
  counts.housingUnits = housing.changes ?? 0;

  await db.run(`DELETE FROM housing_applications WHERE notes LIKE '%Family of 4%'`);
  await db.run(`DELETE FROM scholarship_programs WHERE name LIKE '%Community Leadership Scholarship%'`);
  await db.run(`DELETE FROM media_content WHERE title LIKE '%Community Impact Report Q1%'`);
  await db.run(`DELETE FROM media_broadcasts WHERE title = 'Morning Community Hour'`);
  await db.run(`DELETE FROM hq_documents WHERE title = 'IFCDC Employee Handbook 2026'`);

  const assets = await db.run(`DELETE FROM assets WHERE asset_tag = 'IFCDC-LT-001'`);
  counts.assets = assets.changes ?? 0;

  const fleet = await db.run(`DELETE FROM fleet_vehicles WHERE license_plate = 'IFC-2022'`);
  counts.fleet = fleet.changes ?? 0;

  await db.run(`DELETE FROM facilities WHERE name = 'IFCDC Headquarters' AND address = '100 Enterprise Blvd'`);
  await db.run(`DELETE FROM board_meetings WHERE title LIKE 'Q2 Board of Directors Meeting%'`);
  await db.run(`DELETE FROM compliance_risks WHERE title = 'Grant reporting deadline backlog'`);

  const events = await db.run(`DELETE FROM org_events WHERE title = 'All-Staff Town Hall'`);
  counts.events = events.changes ?? 0;

  const purged = Object.values(counts).reduce((a, b) => a + b, 0);
  if (purged > 0) {
    console.log(`HQ production cleanup: removed ${purged} sample records`, counts);
  }

  return counts;
}
