/**
 * AURA Intelligence Metrics — Command Center dashboard for quality & continuous improvement.
 */
import { getDb } from "../db";
import { ensureTechCommandTables } from "./auraTechnicalCommandEngine";
import { ensureProactiveIntelligenceTables } from "./auraProactiveIntelligence";
import { getKnowledgeBaseStatus } from "./knowledgeBaseEngine";
import { buildTechnicalCommandBriefing } from "./auraTechnicalCommandEngine";

export type AuraIntelligenceMetrics = {
  generatedAt: string;
  commands: {
    completed24h: number;
    failed24h: number;
    blocked24h: number;
    total24h: number;
  };
  tools: {
    successRate24h: number | null;
    techCommands24h: number;
    decisionSupport24h: number;
    orgMemory24h: number;
  };
  knowledge: {
    totalDocuments: number;
    embedded: number;
    bySource: Array<{ source_type: string; count: number }>;
    retrievalQualityHint: string;
  };
  alerts: {
    proactiveEmitted24h: number;
    openRepairTickets: number;
  };
  technical: {
    healthScore: number | null;
    healthLabel: string | null;
    liveCommit: string | null;
    deployAligned: boolean | null;
  };
  outstandingGaps: string[];
  recommendedUpgrades: string[];
  averageResponseHint: string;
};

async function countAudit(actionLike: string, sinceIso: string): Promise<number> {
  try {
    const db = await getDb();
    const row = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM hq_audit_log WHERE action LIKE ? AND created_at >= ?`,
      actionLike,
      sinceIso
    );
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function buildAuraIntelligenceMetrics(): Promise<AuraIntelligenceMetrics> {
  await ensureTechCommandTables();
  await ensureProactiveIntelligenceTables();
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const db = await getDb();

  const [
    kb,
    tech,
    completed,
    failed,
    blocked,
    decisionSupport,
    orgMemory,
    techCmds,
  ] = await Promise.all([
    getKnowledgeBaseStatus().catch(() => null),
    buildTechnicalCommandBriefing().catch(() => null),
    countAudit("aura_%", since),
    countAudit("%_failed%", since),
    countAudit("%blocked%", since),
    countAudit("aura_decision_support", since),
    countAudit("aura_org_memory_retrieve", since),
    countAudit("aura_tech_%", since),
  ]);

  let openRepairTickets = 0;
  let proactiveEmitted24h = 0;
  try {
    openRepairTickets =
      (await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM aura_tech_repair_tickets WHERE status NOT IN ('resolved','wont_fix')`
      ))?.c ?? 0;
    proactiveEmitted24h =
      (await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM aura_proactive_alert_dedupe WHERE last_emitted_at >= ?`,
        since
      ))?.c ?? 0;
  } catch {
    /* tables may be fresh */
  }

  const total24h = completed;
  const failed24h = failed;
  const blocked24h = blocked;
  const successDenom = Math.max(1, techCmds + decisionSupport + orgMemory);
  const successRate24h = Math.round(((techCmds + decisionSupport + orgMemory) / successDenom) * 1000) / 10;

  const outstandingGaps: string[] = [];
  const bySource = kb?.bySource || [];
  const sourceMap = Object.fromEntries(bySource.map((r) => [r.source_type, r.count]));
  if (!sourceMap.operating_budget) outstandingGaps.push("Operating budget not indexed in Knowledge Base");
  if (!sourceMap.hr_budget) outstandingGaps.push("HR budget not indexed in Knowledge Base");
  if (!sourceMap.program_description) outstandingGaps.push("Program descriptions thin in Knowledge Base");
  if (tech && tech.overallScore < 85) outstandingGaps.push(`Technical health degraded (${tech.overallScore}/100)`);
  if (openRepairTickets > 0) outstandingGaps.push(`${openRepairTickets} open technical repair ticket(s)`);

  const recommendedUpgrades = [
    "Keep Knowledge Base synced after every budget/program document approval",
    "Verify ifcdc.org in Resend so Founder OTP email uses the official domain",
    "Extend Founder voice sessions to always route cross-module questions through Decision Support tools",
    "Wire proactive scan into the HQ scheduler with SMS only for high-priority alerts",
  ];

  return {
    generatedAt: new Date().toISOString(),
    commands: {
      completed24h: total24h,
      failed24h,
      blocked24h,
      total24h,
    },
    tools: {
      successRate24h: successDenom > 0 ? successRate24h : null,
      techCommands24h: techCmds,
      decisionSupport24h: decisionSupport,
      orgMemory24h: orgMemory,
    },
    knowledge: {
      totalDocuments: kb?.total ?? 0,
      embedded: kb?.embedded ?? 0,
      bySource,
      retrievalQualityHint:
        (kb?.embedded ?? 0) > 0
          ? "Semantic retrieval available"
          : "Embeddings limited — keyword fallback active; enable embedding sync",
    },
    alerts: {
      proactiveEmitted24h,
      openRepairTickets,
    },
    technical: {
      healthScore: tech?.overallScore ?? null,
      healthLabel: tech?.overallLabel ?? null,
      liveCommit: tech?.liveCommit ?? null,
      deployAligned: tech?.deployAligned ?? null,
    },
    outstandingGaps,
    recommendedUpgrades,
    averageResponseHint: "Voice tech/decision short-circuits typically complete within a few seconds; full LLM turns vary by OpenAI latency.",
  };
}
