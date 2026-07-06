/**
 * AURA Executive Receptionist — IFCDC HQ knowledge base + live retrieval.
 */
import { getDb } from "../db";
import { searchHqModules } from "./auraModuleSearch";
import { PROGRAM_DEFINITIONS } from "./programsSchema";
import { parseNavigationIntent } from "./auraNlNavigation";

const KNOWLEDGE_CACHE_TTL_MS = 5 * 60_000;
let cachedDynamicKnowledge: { at: number; text: string } | null = null;

/** Core IFCDC org knowledge — always available to AURA receptionist. */
export const IFCDC_RECEPTIONIST_CORE = `
IMPERIAL FOUNDATION COMMUNITY DEVELOPMENT CORPORATION (IFCDC)
501(c)(3) nonprofit · Asbury Park, New Jersey
Executive Director: Mr. Fahreal Allah
Main email: service@ifcdc.org
HQ phone (AURA line): +1 (331) 316-8167
Legacy office line: +1 (732) 743-5048
Address: 1215 Springwood Ave Suite 28, Asbury Park, NJ 07712

HEADQUARTERS DEPARTMENTS
- Executive Leadership — strategy, governance, founder decisions
- Human Resources — staff, volunteers, onboarding, certifications
- Programs & Services — housing, youth, outreach, case management
- Barbershop Operations — IFCDC Barbers App, appointments, grooming services
- Media & Radio — IFCDC Radio shoutouts, publishing, music division
- Finance & Grants — accounting, grant writing, compliance, donations
- Technology — Software Division, IFCDC Barbers App, Music, Tapis, Inclusive Community
- Community Outreach — events, resource fairs, neighborhood engagement

COMMUNITY PROGRAMS
- Transitional Housing — safe housing and case management for families
- Anti-Gang / Youth Safety — violence prevention and intervention
- Scholarships — educational awards and application support
- Youth Mentorship — mentor matching and development tracking
- Community Outreach — events and neighborhood engagement
- Economic Development — job training, workforce, small business support

SOFTWARE DIVISION (IFCDC apps)
- IFCDC Barbers App — flagship App Store barbershop booking (production)
- IFCDC Music App — music platform
- IFCDC Tapis (Mentor) — mentorship platform
- Inclusive Community — accessibility and community support
- Swift-Ware, CryptoCoin — in development

SERVICES AURA CAN HELP WITH
- Barbershop appointments (haircut, beard, lineup, kids cut) — can book by phone
- Grant information and Opportunity Finder at Headquarters
- Program enrollment questions — routes to Programs team
- Donations and fundraising — PayPal and Stripe at HQ
- Document and records requests — confidential, routed to Executive office
- Housing applications — intake and status questions
- Radio shoutouts — IFCDC Radio line +1 (858) 758-8791
- General hours, location, contact, and what IFCDC does in the community

ROUTING GUIDE (when caller needs a person)
- Barbershop / haircut / grooming → Barbershop team (transfer available)
- Grants / funding / applications → Finance & Grants
- Housing / shelter → Programs & Housing
- HR / employment → Human Resources
- Donations / billing → Finance Center
- Media / radio / music → Media & Radio division
- Executive / founder / board → Executive Leadership (callback task)
- Technical / app issues → Software Division

BOOKING (Barbershop)
Services: Haircut ($25, 30min), Beard Trim ($15), Haircut+Beard ($35), Line Up ($15), Kids Cut ($20), Full Shave ($25)
Need: first name, last name, phone, preferred date, preferred time, service type
`.trim();

export async function buildDynamicOrgKnowledge(): Promise<string> {
  const now = Date.now();
  if (cachedDynamicKnowledge && now - cachedDynamicKnowledge.at < KNOWLEDGE_CACHE_TTL_MS) {
    return cachedDynamicKnowledge.text;
  }

  const lines: string[] = ["LIVE HQ DATA (from Headquarters database):"];
  try {
    const db = await getDb();
    const programs = (await db.all(
      "SELECT slug, name, description, status FROM hq_program_registry WHERE status = 'active' LIMIT 12"
    )) as { slug: string; name: string; description: string; status: string }[];
    if (programs.length) {
      lines.push("Active programs:");
      for (const p of programs) {
        lines.push(`- ${p.name}: ${(p.description || "").slice(0, 120)}`);
      }
    } else {
      lines.push("Programs:");
      for (const [slug, def] of Object.entries(PROGRAM_DEFINITIONS)) {
        lines.push(`- ${def.name}: ${def.description.slice(0, 100)}`);
      }
    }

    const grantCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_opportunities WHERE status != 'closed'"))?.c ?? 0;
    if (grantCount) lines.push(`Open grant opportunities in HQ: ${grantCount}`);
    try {
      const { buildGrantIntelligenceDashboard } = await import("./grantIntelligenceEngine");
      const intel = await buildGrantIntelligenceDashboard();
      lines.push(
        `Grant pipeline: $${intel.summary.totalPipelineValue.toLocaleString()} · Secured: $${intel.summary.totalFundingSecured.toLocaleString()} · ${intel.summary.newOpportunities} new this week · ${intel.summary.grantsBeingWritten} in draft`
      );
    } catch {
      /* grant intelligence optional */
    }

    const openTasks = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM outreach_tasks WHERE status = 'OPEN'"))?.c ?? 0;
    if (openTasks) lines.push(`Open outreach follow-ups: ${openTasks}`);
  } catch {
    lines.push("(Live HQ metrics temporarily unavailable)");
  }

  const text = lines.join("\n");
  cachedDynamicKnowledge = { at: now, text };
  return text;
}

async function searchDocumentKnowledge(query: string, limit = 4): Promise<string[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const db = await getDb();
    const like = `%${q}%`;
    const rows = (await db.all(
      `SELECT title, category, ocr_text FROM hq_documents
       WHERE title LIKE ? OR category LIKE ? OR ocr_text LIKE ?
       LIMIT ?`,
      like,
      like,
      like,
      limit
    )) as { title: string; category: string; ocr_text: string | null }[];
    return rows.map((r) => {
      const excerpt = (r.ocr_text || "").replace(/\s+/g, " ").slice(0, 200);
      return `Document: ${r.title} (${r.category})${excerpt ? ` — ${excerpt}` : ""}`;
    });
  } catch {
    return [];
  }
}

/** Retrieve relevant HQ knowledge for the caller's question. */
export async function retrieveReceptionistKnowledge(query: string): Promise<string> {
  const sections: string[] = [IFCDC_RECEPTIONIST_CORE];

  const dynamic = await buildDynamicOrgKnowledge();
  sections.push(dynamic);

  const nav = parseNavigationIntent(query);
  if (nav) {
    sections.push(`HQ module match: ${nav.label} (${nav.path}) — confidence ${nav.confidence}`);
  }

  const [moduleHits, docHits] = await Promise.all([
    searchHqModules(query, 6),
    searchDocumentKnowledge(query, 4),
  ]);

  if (moduleHits.length) {
    sections.push(
      "Matching HQ records:\n" +
        moduleHits.map((h) => `- [${h.module}] ${h.title}: ${h.subtitle}`).join("\n")
    );
  }

  if (docHits.length) {
    sections.push("Relevant documents:\n" + docHits.map((d) => `- ${d}`).join("\n"));
  }

  return sections.join("\n\n");
}

export function invalidateReceptionistKnowledgeCache(): void {
  cachedDynamicKnowledge = null;
}
