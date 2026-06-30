/**
 * IFCDC Headquarters — Grant Pipeline System of Record (Phase 3 M3.2)
 * Kanban workflow engine backed by lifecycle_stage columns.
 */
import { getDb } from "../db";
import { logGrantActivity } from "./grantsSchema";
import { logHqAudit } from "./hqAuditLog";
import {
  GRANT_LIFECYCLE_STAGES,
  GRANT_LIFECYCLE_LABELS,
  updateGrantLifecycleStage,
  buildGrantLifecyclePipeline,
} from "./grantFundingEngineV4";

export { GRANT_LIFECYCLE_STAGES, GRANT_LIFECYCLE_LABELS };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  prospect: ["eligibility_review", "application_drafting"],
  eligibility_review: ["prospect", "internal_approval", "application_drafting"],
  internal_approval: ["application_drafting", "eligibility_review"],
  application_drafting: ["internal_approval", "submitted", "eligibility_review"],
  submitted: ["under_review", "application_drafting"],
  under_review: ["awarded", "submitted", "closeout"],
  awarded: ["active_grant", "reporting"],
  active_grant: ["reporting", "closeout"],
  reporting: ["closeout", "renewal"],
  closeout: ["renewal"],
  renewal: ["prospect", "application_drafting"],
};

export interface PipelineKanbanItem {
  id: string;
  entityType: "opportunity" | "application" | "award";
  title: string;
  amount: number;
  status: string;
  lifecycleStage: string;
  deadline: string | null;
  updatedAt: string | null;
}

export interface PipelineKanbanColumn {
  stageKey: string;
  label: string;
  count: number;
  value: number;
  items: PipelineKanbanItem[];
}

export async function buildPipelineKanbanBoard(limitPerStage = 25): Promise<{
  columns: PipelineKanbanColumn[];
  summary: Awaited<ReturnType<typeof buildGrantLifecyclePipeline>>;
  generatedAt: string;
}> {
  const db = await getDb();
  const summary = await buildGrantLifecyclePipeline();
  const columns: PipelineKanbanColumn[] = [];

  for (const stageKey of GRANT_LIFECYCLE_STAGES) {
    const label = GRANT_LIFECYCLE_LABELS[stageKey];
    const stageSummary = summary.stages.find((s) => s.stageKey === stageKey);

    const oppRows = (await db.all(
      `SELECT id, title, COALESCE(amount_max, 0) as amount, status, lifecycle_stage, deadline, updated_at
       FROM grant_opportunities WHERE COALESCE(lifecycle_stage, 'prospect') = ?
       ORDER BY deadline IS NULL, deadline ASC LIMIT ?`,
      stageKey,
      limitPerStage,
    )) as Record<string, unknown>[];

    const appRows = (await db.all(
      `SELECT id, title, COALESCE(amount_requested, 0) as amount, status, lifecycle_stage, deadline, updated_at
       FROM grant_applications WHERE COALESCE(lifecycle_stage, 'application_drafting') = ?
       ORDER BY updated_at DESC LIMIT ?`,
      stageKey,
      limitPerStage,
    )) as Record<string, unknown>[];

    const awardRows = (await db.all(
      `SELECT ga.id, COALESCE(o.title, a.title, 'Award') as title, COALESCE(ga.amount, 0) as amount,
              ga.status, ga.lifecycle_stage, ga.period_end as deadline, ga.updated_at
       FROM grant_awards ga
       LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
       LEFT JOIN grant_applications a ON a.id = ga.application_id
       WHERE COALESCE(ga.lifecycle_stage, 'active_grant') = ?
       ORDER BY ga.updated_at DESC LIMIT ?`,
      stageKey,
      limitPerStage,
    )) as Record<string, unknown>[];

    const items: PipelineKanbanItem[] = [
      ...oppRows.map((r) => mapRow(r, "opportunity")),
      ...appRows.map((r) => mapRow(r, "application")),
      ...awardRows.map((r) => mapRow(r, "award")),
    ].slice(0, limitPerStage);

    columns.push({
      stageKey,
      label,
      count: stageSummary?.count ?? items.length,
      value: stageSummary?.value ?? 0,
      items,
    });
  }

  return { columns, summary, generatedAt: new Date().toISOString() };
}

function mapRow(row: Record<string, unknown>, entityType: PipelineKanbanItem["entityType"]): PipelineKanbanItem {
  return {
    id: String(row.id),
    entityType,
    title: String(row.title ?? "Untitled"),
    amount: Number(row.amount ?? 0),
    status: String(row.status ?? ""),
    lifecycleStage: String(row.lifecycle_stage ?? ""),
    deadline: row.deadline ? String(row.deadline) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function transitionPipelineEntity(opts: {
  entityType: "opportunity" | "application" | "award";
  entityId: string;
  toStage: string;
  actorEmail?: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string; fromStage?: string; toStage?: string }> {
  if (!GRANT_LIFECYCLE_STAGES.includes(opts.toStage as (typeof GRANT_LIFECYCLE_STAGES)[number])) {
    return { ok: false, error: "Invalid lifecycle stage" };
  }

  const db = await getDb();
  const table =
    opts.entityType === "opportunity"
      ? "grant_opportunities"
      : opts.entityType === "application"
        ? "grant_applications"
        : "grant_awards";

  const row = (await db.get(`SELECT id, lifecycle_stage, title FROM ${table} WHERE id = ?`, opts.entityId)) as
    | { id: string; lifecycle_stage: string | null; title: string }
    | undefined;

  if (!row) return { ok: false, error: "Entity not found" };

  const fromStage = row.lifecycle_stage || GRANT_LIFECYCLE_STAGES[0];
  const allowed = ALLOWED_TRANSITIONS[fromStage] ?? GRANT_LIFECYCLE_STAGES.filter((s) => s !== fromStage);
  if (!allowed.includes(opts.toStage) && fromStage !== opts.toStage) {
    return { ok: false, error: `Transition from ${fromStage} to ${opts.toStage} is not allowed`, fromStage, toStage: opts.toStage };
  }

  await updateGrantLifecycleStage({
    entityType: opts.entityType,
    entityId: opts.entityId,
    lifecycleStage: opts.toStage,
    actorEmail: opts.actorEmail,
  });

  await logGrantActivity(
    opts.entityType,
    opts.entityId,
    "pipeline_transition",
    JSON.stringify({ fromStage, toStage: opts.toStage, note: opts.note ?? null }),
    opts.actorEmail,
  );

  await logHqAudit({
    action: "GRANT_PIPELINE_TRANSITION",
    entityType: opts.entityType,
    entityId: opts.entityId,
    actorEmail: opts.actorEmail,
    metadata: { fromStage, toStage: opts.toStage, title: row.title },
  });

  return { ok: true, fromStage, toStage: opts.toStage };
}
