import { ensureGrantTables } from "./grantsSchema";
import { ensureFinanceTables } from "./financeSchema";
import { ensureGrantCenterTables } from "./grantCenterEngine";
import { ensureFunderCrmTables } from "./grantFunderCrm";

let readyPromise: Promise<void> | null = null;

/** Run grant DDL once per process (boot + first route); avoids per-request schema migration. */
export function ensureGrantModulesReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureGrantTables();
      await ensureFinanceTables();
      await ensureGrantCenterTables();
      await ensureFunderCrmTables();
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}
