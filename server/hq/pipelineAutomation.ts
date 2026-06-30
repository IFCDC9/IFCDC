/**
 * IFCDC Headquarters — Grant Pipeline Automation (Phase 3 M3.2)
 * Rule-based notifications and workflow triggers on pipeline transitions.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { enqueueNotification } from "./notificationQueue";
import { GRANT_LIFECYCLE_LABELS } from "./grantFundingEngineV4";

export interface PipelineAutomationRule {
  id: string;
  trigger: "stage_enter" | "stage_exit" | "deadline_approaching";
  stage?: string;
  daysBeforeDeadline?: number;
  action: "notify" | "audit";
  priority: "high" | "normal" | "low";
  titleTemplate: string;
  messageTemplate: string;
  enabled: boolean;
}

export const DEFAULT_PIPELINE_RULES: PipelineAutomationRule[] = [
  {
    id: "notify_submitted",
    trigger: "stage_enter",
    stage: "submitted",
    action: "notify",
    priority: "normal",
    titleTemplate: "Grant submitted for review",
    messageTemplate: "{title} moved to Submitted — internal review required.",
    enabled: true,
  },
  {
    id: "notify_awarded",
    trigger: "stage_enter",
    stage: "awarded",
    action: "notify",
    priority: "high",
    titleTemplate: "Grant awarded",
    messageTemplate: "{title} has been awarded — activate finance and compliance workflows.",
    enabled: true,
  },
  {
    id: "notify_internal_approval",
    trigger: "stage_enter",
    stage: "internal_approval",
    action: "notify",
    priority: "normal",
    titleTemplate: "Internal approval required",
    messageTemplate: "{title} requires executive approval before application drafting continues.",
    enabled: true,
  },
  {
    id: "deadline_7_day",
    trigger: "deadline_approaching",
    stage: "application_drafting",
    daysBeforeDeadline: 7,
    action: "notify",
    priority: "high",
    titleTemplate: "Grant deadline approaching",
    messageTemplate: "{title} deadline is within 7 days — prioritize completion.",
    enabled: true,
  },
];

export async function ensurePipelineAutomationTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_pipeline_automation_log (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      action TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_auto_log_entity ON grant_pipeline_automation_log(entity_type, entity_id, created_at DESC);
  `);
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

export async function listPipelineAutomationRules(): Promise<PipelineAutomationRule[]> {
  return DEFAULT_PIPELINE_RULES;
}

export async function listPipelineAutomationLog(limit = 50) {
  await ensurePipelineAutomationTables();
  const db = await getDb();
  return db.all(
    `SELECT * FROM grant_pipeline_automation_log ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
}

export async function runPipelineAutomationOnTransition(opts: {
  entityType: string;
  entityId: string;
  title: string;
  fromStage: string;
  toStage: string;
  actorEmail?: string;
}): Promise<{ triggered: number; ruleIds: string[] }> {
  await ensurePipelineAutomationTables();
  const db = await getDb();
  const rules = DEFAULT_PIPELINE_RULES.filter((r) => r.enabled);
  const triggered: string[] = [];
  const stageLabel = (GRANT_LIFECYCLE_LABELS as Record<string, string>)[opts.toStage] ?? opts.toStage;

  for (const rule of rules) {
    if (rule.trigger !== "stage_enter" || rule.stage !== opts.toStage) continue;

    const title = interpolate(rule.titleTemplate, { title: opts.title, stage: stageLabel });
    const message = interpolate(rule.messageTemplate, {
      title: opts.title,
      stage: stageLabel,
      fromStage: opts.fromStage,
      toStage: opts.toStage,
    });

    if (rule.action === "notify") {
      await enqueueNotification({
        type: "grant_pipeline",
        title,
        message,
        priority: rule.priority,
        path: "/hq/grants?tab=pipeline",
        payload: {
          entityType: opts.entityType,
          entityId: opts.entityId,
          fromStage: opts.fromStage,
          toStage: opts.toStage,
        },
      });
    }

    await db.run(
      `INSERT INTO grant_pipeline_automation_log (id, rule_id, entity_type, entity_id, from_stage, to_stage, action, status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      crypto.randomUUID(),
      rule.id,
      opts.entityType,
      opts.entityId,
      opts.fromStage,
      opts.toStage,
      rule.action,
      message,
      new Date().toISOString(),
    );
    triggered.push(rule.id);
  }

  return { triggered: triggered.length, ruleIds: triggered };
}

export async function scanPipelineDeadlineAlerts(daysAhead = 7): Promise<{ alertsSent: number }> {
  await ensurePipelineAutomationTables();
  const db = await getDb();
  const rules = DEFAULT_PIPELINE_RULES.filter(
    (r) => r.enabled && r.trigger === "deadline_approaching" && r.daysBeforeDeadline,
  );
  if (!rules.length) return { alertsSent: 0 };

  const now = new Date();
  const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  let alertsSent = 0;

  for (const rule of rules) {
    const rows = (await db.all(
      `SELECT id, title, deadline, lifecycle_stage FROM grant_opportunities
       WHERE deadline IS NOT NULL AND deadline >= ? AND deadline <= ?
         AND COALESCE(lifecycle_stage, 'prospect') = ?`,
      now.toISOString(),
      horizon.toISOString(),
      rule.stage ?? "application_drafting",
    )) as { id: string; title: string; deadline: string; lifecycle_stage: string }[];

    for (const row of rows) {
      const logKey = `deadline-${rule.id}-${row.id}`;
      const existing = await db.get(
        `SELECT 1 FROM grant_pipeline_automation_log WHERE rule_id = ? AND entity_id = ? AND created_at >= ?`,
        rule.id,
        row.id,
        new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      );
      if (existing) continue;

      const message = interpolate(rule.messageTemplate, { title: row.title, stage: row.lifecycle_stage });
      await enqueueNotification({
        type: "grant_pipeline_deadline",
        title: interpolate(rule.titleTemplate, { title: row.title }),
        message,
        priority: rule.priority,
        path: "/hq/grants?tab=pipeline",
        payload: { opportunityId: row.id, deadline: row.deadline },
      });
      await db.run(
        `INSERT INTO grant_pipeline_automation_log (id, rule_id, entity_type, entity_id, from_stage, to_stage, action, status, detail, created_at)
         VALUES (?, ?, 'opportunity', ?, ?, ?, 'notify', 'completed', ?, ?)`,
        crypto.randomUUID(),
        logKey,
        row.id,
        row.lifecycle_stage,
        row.lifecycle_stage,
        message,
        new Date().toISOString(),
      );
      alertsSent++;
    }
  }

  return { alertsSent };
}
