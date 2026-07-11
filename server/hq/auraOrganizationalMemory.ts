/**
 * AURA Organizational Memory — verified facts from approved HQ knowledge + live modules.
 * Always separates verified facts from recommendations; never invents data.
 */
import { retrieveKnowledge, getKnowledgeBaseStatus, type RetrievedChunk } from "./knowledgeBaseEngine";
import { IFCDC_ORG_PROFILE } from "./grantWriterEngine";
import { buildTechnicalCommandBriefing } from "./auraTechnicalCommandEngine";
import { logHqAudit } from "./hqAuditLog";

export type MemoryCitation = {
  source: string;
  title: string;
  sourceType?: string;
  recordId?: string;
  excerpt: string;
  verified: boolean;
};

export type MemoryFact = {
  kind: "fact";
  statement: string;
  citation: MemoryCitation;
  module: string;
};

export type MemoryRecommendation = {
  kind: "recommendation";
  statement: string;
  rationale: string;
  founderApprovalRequired: boolean;
};

export type OrganizationalMemoryResult = {
  query: string;
  generatedAt: string;
  facts: MemoryFact[];
  recommendations: MemoryRecommendation[];
  gaps: string[];
  citations: MemoryCitation[];
  speechSummary: string;
  smsSummary: string;
};

function chunkToCitation(chunk: RetrievedChunk): MemoryCitation {
  return {
    source: "knowledge_base",
    title: chunk.title || chunk.sourceType || "HQ knowledge",
    sourceType: chunk.sourceType,
    recordId: chunk.documentId,
    excerpt: (chunk.content || "").slice(0, 280),
    verified: true,
  };
}

function detectGaps(
  query: string,
  facts: MemoryFact[],
  kbStatus: Awaited<ReturnType<typeof getKnowledgeBaseStatus>>
): string[] {
  const gaps: string[] = [];
  const q = query.toLowerCase();
  if (!facts.length) gaps.push("No approved knowledge chunks matched this query.");
  const bySource: Record<string, number> = {};
  for (const row of kbStatus.bySource || []) {
    bySource[row.source_type] = row.count;
  }
  if ((q.includes("budget") || q.includes("finance") || q.includes("payroll")) && !(bySource.operating_budget || bySource.hr_budget || bySource.financial_report)) {
    gaps.push("Financial knowledge sources are thin — sync operating/HR budgets into Knowledge Base.");
  }
  if ((q.includes("program") || q.includes("case manager") || q.includes("staffing")) && !bySource.program_description) {
    gaps.push("Program description knowledge may be incomplete.");
  }
  if (q.includes("grant") && !bySource.grant_template && !bySource.prior_narrative) {
    gaps.push("Prior grant narratives/templates may be missing from Knowledge Base.");
  }
  return gaps;
}

/** Retrieve organizational memory with explicit fact vs recommendation separation. */
export async function retrieveOrganizationalMemory(
  query: string,
  opts?: { topK?: number; includeTechHealth?: boolean }
): Promise<OrganizationalMemoryResult> {
  const q = query.trim() || "IFCDC organizational overview";
  const [chunks, kbStatus] = await Promise.all([
    retrieveKnowledge(q, { topK: opts?.topK ?? 8 }),
    getKnowledgeBaseStatus().catch(() => ({
      total: 0,
      embedded: 0,
      chunks: 0,
      embeddingsConfigured: false,
      bySource: [] as Array<{ source_type: string; count: number }>,
      byCategory: [] as Array<{ category: string; count: number }>,
      lastSync: null,
    })),
  ]);

  const facts: MemoryFact[] = [];
  const citations: MemoryCitation[] = [];

  // Always include core verified org profile as a fact when relevant.
  if (/mission|vision|ifcdc|organization|founder|leadership|history/i.test(q) || chunks.length < 2) {
    const profileText = [
      IFCDC_ORG_PROFILE.legalName,
      `Mission: ${IFCDC_ORG_PROFILE.mission}`,
      `Location: ${IFCDC_ORG_PROFILE.location}`,
      IFCDC_ORG_PROFILE.ein ? `EIN note: ${IFCDC_ORG_PROFILE.ein}` : "",
    ].filter(Boolean).join(". ");
    const profileCitation: MemoryCitation = {
      source: "grant_writer_org_profile",
      title: "IFCDC Organization Profile (approved code source)",
      sourceType: "org_profile",
      excerpt: profileText.slice(0, 280),
      verified: true,
    };
    citations.push(profileCitation);
    facts.push({
      kind: "fact",
      statement: profileText.slice(0, 500),
      citation: profileCitation,
      module: "organization",
    });
  }

  for (const chunk of chunks) {
    const citation = chunkToCitation(chunk);
    citations.push(citation);
    facts.push({
      kind: "fact",
      statement: (chunk.content || "").slice(0, 600),
      citation,
      module: chunk.category || chunk.sourceType || "knowledge",
    });
  }

  const recommendations: MemoryRecommendation[] = [];
  if (opts?.includeTechHealth !== false && /health|system|deploy|integration|technical/i.test(q)) {
    try {
      const briefing = await buildTechnicalCommandBriefing();
      for (const f of [...briefing.critical, ...briefing.warnings].slice(0, 4)) {
        recommendations.push({
          kind: "recommendation",
          statement: f.recommendedFix || f.title,
          rationale: `${f.title}: ${f.detail}`,
          founderApprovalRequired: Boolean(f.needsFounderApproval),
        });
      }
    } catch {
      /* tech briefing optional */
    }
  }

  if (!facts.length) {
    recommendations.push({
      kind: "recommendation",
      statement: "Sync or approve Knowledge Base documents covering this topic, then ask again.",
      rationale: "No verified HQ records were retrieved for this query.",
      founderApprovalRequired: false,
    });
  }

  const gaps = detectGaps(q, facts, kbStatus);
  const speechSummary = [
    `I found ${facts.length} verified fact${facts.length === 1 ? "" : "s"} from approved HQ records.`,
    gaps.length ? `Gaps: ${gaps[0]}` : "No major knowledge gaps flagged for this query.",
    recommendations.length
      ? `I also have ${recommendations.length} recommendation${recommendations.length === 1 ? "" : "s"} — separate from verified facts.`
      : "No recommendations beyond the verified facts.",
  ].join(" ");

  const smsSummary = [
    `Memory: ${facts.length} facts`,
    gaps[0] ? `Gap: ${gaps[0].slice(0, 80)}` : "No gaps",
    recommendations[0] ? `Rec: ${recommendations[0].statement.slice(0, 80)}` : "No recs",
  ].join("\n");

  await logHqAudit({
    action: "aura_org_memory_retrieve",
    entityType: "aura_intelligence",
    detail: q.slice(0, 200),
    metadata: { facts: facts.length, recommendations: recommendations.length, gaps: gaps.length },
  }).catch(() => undefined);

  return {
    query: q,
    generatedAt: new Date().toISOString(),
    facts: facts.slice(0, 12),
    recommendations: recommendations.slice(0, 8),
    gaps,
    citations: citations.slice(0, 12),
    speechSummary,
    smsSummary,
  };
}
