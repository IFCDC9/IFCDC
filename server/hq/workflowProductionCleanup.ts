import { getDb } from "../db";
import { allowHqDemoSeed } from "./grantProductionPolicy";

/** Remove demo / readiness-seed workflow and approval artifacts from production. */
export async function purgeWorkflowDemoData(): Promise<Record<string, number>> {
  if (allowHqDemoSeed()) {
    return { workflowInstances: 0, workflowSteps: 0, grantDeadlines: 0 };
  }

  const db = await getDb();
  const counts: Record<string, number> = {};

  const demoInstances = (await db.all(
    `SELECT id FROM hq_workflow_instances
     WHERE entity_id = 'seed-demo'
        OR title LIKE '%demo%'
        OR title LIKE '%Enterprise readiness%'
        OR title LIKE '%readiness —%'`
  )) as { id: string }[];

  for (const row of demoInstances) {
    await db.run("DELETE FROM hq_workflow_steps WHERE instance_id = ?", row.id);
    await db.run("DELETE FROM hq_workflow_instances WHERE id = ?", row.id);
  }
  counts.workflowInstances = demoInstances.length;

  const orphanSteps = await db.run(
    `DELETE FROM hq_workflow_steps WHERE instance_id NOT IN (SELECT id FROM hq_workflow_instances)`
  );
  counts.workflowSteps = orphanSteps.changes ?? 0;

  const deadlines = await db.run(
    `DELETE FROM grant_deadlines WHERE opportunity_id IN (
       SELECT id FROM grant_opportunities WHERE source_type = 'dev_seed' OR import_status = 'seed'
     )`
  );
  counts.grantDeadlines = deadlines.changes ?? 0;

  const purged = Object.values(counts).reduce((a, b) => a + b, 0);
  if (purged > 0) {
    console.log(`Workflow production cleanup: removed ${purged} demo records`, counts);
  }

  return counts;
}

export function productionWorkflowInstanceSqlFilter(alias?: string): string {
  if (allowHqDemoSeed()) return "";
  const p = alias ? `${alias}.` : "";
  return ` AND ${p}entity_id != 'seed-demo' AND ${p}title NOT LIKE '%demo%' AND ${p}title NOT LIKE '%Enterprise readiness%'`;
}
