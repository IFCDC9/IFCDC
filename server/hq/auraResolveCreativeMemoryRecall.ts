/**
 * Device-independent recall of Founder video-editing rules from
 * aura_resolve_creative_memory (same store GET /aura/resolve/status returns).
 * No new database — reads via listAuraResolveCreativeMemory.
 */

export const FOUNDER_VIDEO_EDITING_RULE_ID = "IFCDC_VIDEO_EDITING_FOUNDER_RULES_20260928";

export type CreativeMemoryRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type FounderVideoEditingRuleHit = {
  recordId: string;
  kind: string;
  createdAt: string;
  permanentRuleId: string;
  permanentRule: Record<string, unknown>;
};

function tryParseJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function ruleLooksLikeFounderVideoEditing(rule: Record<string, unknown> | null, ruleId: string | null): boolean {
  if (!rule && !ruleId) return false;
  if (ruleId === FOUNDER_VIDEO_EDITING_RULE_ID) return true;
  if (rule?.id === FOUNDER_VIDEO_EDITING_RULE_ID) return true;
  const rules = rule?.rules;
  if (rules && typeof rules === "object") {
    const keys = Object.keys(rules as object);
    return (
      keys.includes("musicToPicture") ||
      keys.includes("storyStructure") ||
      keys.includes("watermarkCircularAlpha") ||
      keys.includes("framingFitFirst")
    );
  }
  return false;
}

/** Pull Founder permanent video-editing rules out of HQ creative-memory rows. */
export function extractFounderVideoEditingRules(rows: CreativeMemoryRow[]): FounderVideoEditingRuleHit[] {
  const hits: FounderVideoEditingRuleHit[] = [];
  for (const row of rows) {
    const payload = row.payload || {};
    let permanentRule =
      payload.permanentRule && typeof payload.permanentRule === "object"
        ? (payload.permanentRule as Record<string, unknown>)
        : null;
    let permanentRuleId =
      typeof payload.permanentRuleId === "string"
        ? payload.permanentRuleId
        : typeof permanentRule?.id === "string"
          ? permanentRule.id
          : null;

    const fromNote = tryParseJson(payload.revisionNote);
    if (fromNote) {
      if (!permanentRule && fromNote.permanentRule && typeof fromNote.permanentRule === "object") {
        permanentRule = fromNote.permanentRule as Record<string, unknown>;
      }
      if (!permanentRuleId && typeof fromNote.permanentRuleId === "string") {
        permanentRuleId = fromNote.permanentRuleId;
      }
      if (!permanentRule && fromNote.rules && typeof fromNote.rules === "object") {
        permanentRule = fromNote;
        permanentRuleId =
          permanentRuleId ||
          (typeof fromNote.id === "string" ? fromNote.id : FOUNDER_VIDEO_EDITING_RULE_ID);
      }
    }

    const fromInstruction = tryParseJson(payload.instruction);
    if (fromInstruction?.permanentRule && typeof fromInstruction.permanentRule === "object") {
      if (!permanentRule) permanentRule = fromInstruction.permanentRule as Record<string, unknown>;
      if (!permanentRuleId && typeof fromInstruction.permanentRuleId === "string") {
        permanentRuleId = fromInstruction.permanentRuleId;
      }
    }

    if (!ruleLooksLikeFounderVideoEditing(permanentRule, permanentRuleId) || !permanentRule) continue;

    const id =
      permanentRuleId ||
      (typeof permanentRule.id === "string" ? permanentRule.id : FOUNDER_VIDEO_EDITING_RULE_ID);

    hits.push({
      recordId: row.id,
      kind: row.kind,
      createdAt: row.createdAt,
      permanentRuleId: id,
      permanentRule: { ...permanentRule, id },
    });
  }
  // Newest HQ row first (list is already DESC; keep first per rule id)
  const byId = new Map<string, FounderVideoEditingRuleHit>();
  for (const hit of hits) {
    if (!byId.has(hit.permanentRuleId)) byId.set(hit.permanentRuleId, hit);
  }
  return [...byId.values()];
}

export function questionWantsFounderVideoEditingRules(question: string): boolean {
  const q = String(question || "").toLowerCase();
  if (!q.trim()) return false;
  return (
    /video[-\s]?edit/.test(q) ||
    /editing\s+rules?/.test(q) ||
    /founder\s+approved/.test(q) ||
    /approved.*(rule|edit)/.test(q) ||
    /permanent\s+rules?/.test(q) ||
    /creative\s+memory/.test(q) ||
    /what.*rules?.*founder/.test(q) ||
    /rules?.*founder\s+approved/.test(q)
  );
}

function formatRuleBody(permanentRule: Record<string, unknown>): string {
  const rules = (permanentRule.rules || {}) as Record<string, string>;
  const quote = Array.isArray(permanentRule.quote)
    ? (permanentRule.quote as string[])
    : [];
  const lines: string[] = [];
  if (rules.storyStructure) {
    lines.push(
      `Story-led short cuts with a beginning, development, and ending aligned to the music: ${rules.storyStructure}`
    );
  }
  if (rules.musicToPicture) {
    lines.push(`Music-to-picture: ${rules.musicToPicture}`);
  }
  if (rules.screenFraming || rules.framingFitFirst) {
    lines.push(
      `Framing: ${[rules.framingFitFirst, rules.screenFraming].filter(Boolean).join(" ")}`
    );
  }
  if (rules.watermarkCircularAlpha || rules.logoWatermark) {
    lines.push(
      `Watermark: ${[rules.watermarkCircularAlpha, rules.logoWatermark].filter(Boolean).join(" ")}`
    );
  }
  for (const [key, value] of Object.entries(rules)) {
    if (
      ["storyStructure", "musicToPicture", "screenFraming", "framingFitFirst", "watermarkCircularAlpha", "logoWatermark"].includes(
        key
      )
    ) {
      continue;
    }
    if (typeof value === "string" && value.trim()) lines.push(`${key}: ${value}`);
  }
  if (quote.length) {
    lines.push("Approved quotes:");
    for (const q of quote) lines.push(`- ${q}`);
  }
  return lines.join("\n");
}

/** Plain-language answer for status-ask / chat when Founder editing rules are requested. */
export function formatFounderVideoEditingRulesAnswer(hits: FounderVideoEditingRuleHit[]): string {
  if (!hits.length) {
    return "No Founder-approved video-editing rules were found in HQ creative memory yet.";
  }
  const parts = hits.map((hit) => {
    const title =
      typeof hit.permanentRule.title === "string"
        ? hit.permanentRule.title
        : "Founder video-editing rules";
    return [
      `Founder-approved video-editing rules (HQ creative memory).`,
      `Permanent rule id: ${hit.permanentRuleId}.`,
      `HQ record: ${hit.recordId} (${hit.kind}, ${hit.createdAt}).`,
      `Title: ${title}.`,
      formatRuleBody(hit.permanentRule),
      "Source: aura_resolve_creative_memory via HQ (not the Mac-only creative-memory.json).",
      "publish=false.",
    ].join("\n");
  });
  return parts.join("\n\n");
}

export async function loadFounderVideoEditingRulesFromHq(limit = 40): Promise<{
  rows: CreativeMemoryRow[];
  hits: FounderVideoEditingRuleHit[];
}> {
  const { listAuraResolveCreativeMemory } = await import("./auraResolveProductionNode");
  const rows = (await listAuraResolveCreativeMemory(limit)) as CreativeMemoryRow[];
  return { rows, hits: extractFounderVideoEditingRules(rows) };
}

/** status-ask: if the question asks for Founder editing rules, answer from HQ store. */
export async function answerStatusAskFromCreativeMemory(question: string): Promise<{
  handled: boolean;
  answer: string | null;
  hits: FounderVideoEditingRuleHit[];
  creativeMemoryCount: number;
}> {
  const { rows, hits } = await loadFounderVideoEditingRulesFromHq(40);
  if (!questionWantsFounderVideoEditingRules(question)) {
    return { handled: false, answer: null, hits, creativeMemoryCount: rows.length };
  }
  return {
    handled: true,
    answer: formatFounderVideoEditingRulesAnswer(hits),
    hits,
    creativeMemoryCount: rows.length,
  };
}
