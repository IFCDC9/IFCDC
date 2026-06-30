import { getDb } from "../db";
import { allowGrantDemoSeed } from "./grantProductionPolicy";

/** Remove dev_seed demo rows from production SQLite (one-time safe purge). */
export async function purgeGrantDevSeedData(): Promise<{ opportunities: number }> {
  if (allowGrantDemoSeed()) return { opportunities: 0 };
  const db = await getDb();
  const seeded = (await db.all(
    "SELECT id FROM grant_opportunities WHERE source_type = 'dev_seed' OR import_status = 'seed'"
  )) as { id: string }[];
  if (!seeded.length) return { opportunities: 0 };

  for (const row of seeded) {
    const id = row.id;
    await db.run("DELETE FROM grant_deadlines WHERE opportunity_id = ?", id);
    await db.run("DELETE FROM grant_documents WHERE opportunity_id = ?", id);
    await db.run("UPDATE grant_applications SET opportunity_id = NULL WHERE opportunity_id = ?", id);
    await db.run("DELETE FROM grant_opportunities WHERE id = ?", id);
  }
  console.log(`Grant Center: purged ${seeded.length} dev_seed opportunities from production`);
  return { opportunities: seeded.length };
}
