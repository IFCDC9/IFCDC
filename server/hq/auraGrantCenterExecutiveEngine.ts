/**
 * Aura executive funding desk — one Grant Center store for NJ programs and Detroit.
 * Aura is an AI operator. She does not Founder-approve, submit, contact funders, or commit funds.
 */
import { getDb } from "../db";
import { grantId, logGrantActivity, ensureGrantTables } from "./grantsSchema";
import {
  catalogFeedCapabilities,
  previewRegionalDiscovery,
  walkthroughFundingLifecycle,
  type DiscoveryCard,
  type FeedCapability,
} from "./grantRegionalDiscoveryEngine";
import { buildHrStaffFundingPipeline } from "./grantHrStaffFundingPipeline";
import {
  classifyFundingInitiative,
  matchScoreDisclaimer,
  moneyStatusFromGrantRow,
  type FundingInitiative,
} from "../../shared/grantInitiativeScope";
import { AURA_OPERATOR, founderApprovalAllowed, isExcludedExecIdentity } from "./auraActorIdentity";

export const BUDGET_SKELETON = [
  "Proposed budget (not an award and not a funding promise).",
  "Personnel / salary: Unknown until notice of award + terms reviewed.",
  "Fringe / benefits: Unknown until terms reviewed.",
  "NJ program costs: keep distinct from Detroit initiative costs.",
  "Detroit initiative costs: keep distinct from NJ program costs.",
  "Shared-org costs: allocate only after Founder review.",
  "Match / cost share: Unknown.",
  "Payroll is not funded until award + reviewed terms.",
].join("\n");

export function isGrantCenterExecutiveDeskQuery(command: string): boolean {
  const q = command.trim().toLowerCase();
  if (!q) return false;
  if (/\b(submit|contact funder|contact dlba|accept award|purchase|commit funds)\b/.test(q)) return false;
  const regional = /\b(nj|new jersey|detroit|dlba|land bank|sage|sigma|michigan|asbury)\b/.test(q);
  const desk = /grant center|funding desk|executive funding|opportunity finder|hr pipeline|payroll coverage/.test(q);
  const funding = /\b(grant|funding|opportunity|deadline|budget|proposal|follow-?up|discover)\b/.test(q);
  return (regional && funding) || (desk && funding) || /run (the )?funding desk|nj programs and detroit/.test(q);
}

export function initiativeFromAuraContext(blob: string): FundingInitiative | "all" {
  const text = blob.toLowerCase();
  const nj = /\b(nj|new jersey|sage|asbury|monmouth)\b/.test(text);
  const detroit = /\b(detroit|dlba|land bank|michigan|sigma|wayne county)\b/.test(text);
  if (nj && detroit) return "all";
  if (detroit) return "detroit_initiative";
  if (nj) return "nj_programs";
  return "all";
}

export function blockedFeedsWithManualPaths(env: NodeJS.ProcessEnv = process.env): FeedCapability[] {
  return catalogFeedCapabilities(env).filter((feed) => !feed.liveSearch);
}

export function connectedFeeds(env: NodeJS.ProcessEnv = process.env): FeedCapability[] {
  return catalogFeedCapabilities(env).filter((feed) => feed.liveSearch);
}

function fingerprint(card: DiscoveryCard): string {
  const link = card.officialLink && card.officialLink !== "Unknown" ? card.officialLink : card.title;
  return `aura-desk:${card.source}:${link}`.slice(0, 240);
}

export async function persistDiscoveryCardsToGrantCenter(
  cards: DiscoveryCard[],
  actorEmail?: string,
): Promise<{ inserted: number; updated: number; skipped: number; ids: string[] }> {
  await ensureGrantTables();
  const db = await getDb();
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const ids: string[] = [];

  for (const card of cards) {
    if (!card.title || card.title === "Unknown") {
      skipped += 1;
      continue;
    }
    const fp = fingerprint(card);
    const isRfp = card.source.startsWith("Grants.gov");
    const sourceType = isRfp ? "grants_gov" : "foundation_directory";
    const existing = (await db.get(
      "SELECT id FROM grant_opportunities WHERE fingerprint = ? OR (url != '' AND url = ?) LIMIT 1",
      fp,
      card.officialLink !== "Unknown" ? card.officialLink : "",
    ).catch(() => undefined)) as { id: string } | undefined;

    const classified = classifyFundingInitiative({
      title: card.title,
      funder: card.funder,
      geography: card.initiative === "detroit_initiative" ? "Detroit, Michigan" : card.initiative === "nj_programs" ? "New Jersey" : "US",
      initiative_scope: card.initiative,
      source_type: sourceType,
    });
    const eligibility = card.eligibilityEvidence || "Unknown";
    const verification = card.verification === "Official source checked" ? "Official source checked" : "Unknown";
    const deadline = card.deadline !== "Unknown" ? card.deadline : null;
    const isLive = isRfp ? 1 : 0;
    const fundingStatus = "identified";

    if (existing?.id) {
      await db.run(
        `UPDATE grant_opportunities SET
          title = ?, funder = ?, deadline = COALESCE(?, deadline), url = CASE WHEN ? != '' THEN ? ELSE url END,
          eligibility = ?, initiative_scope = ?, date_checked = ?, match_requirements = ?, allowable_costs = ?,
          eligibility_evidence = ?, verification_status = ?, last_verified_at = ?, updated_at = ?,
          funding_status = COALESCE(funding_status, ?), source_type = ?, is_live = ?
         WHERE id = ?`,
        card.title,
        card.funder,
        deadline,
        card.officialLink !== "Unknown" ? card.officialLink : "",
        card.officialLink !== "Unknown" ? card.officialLink : "",
        eligibility,
        classified.initiative,
        card.dateChecked,
        card.matchRequirements,
        card.allowableCosts,
        eligibility,
        verification,
        now,
        now,
        fundingStatus,
        sourceType,
        isLive,
        existing.id,
      );
      updated += 1;
      ids.push(existing.id);
      await logGrantActivity("opportunity", existing.id, "aura_desk_refresh", `Refreshed research: ${card.title}`, actorEmail);
      continue;
    }

    const oppId = grantId();
    await db.run(
      `INSERT INTO grant_opportunities (
        id, title, funder, description, status, deadline, url, eligibility, source_type, fingerprint,
        import_status, is_live, funding_status, lifecycle_stage, last_verified_at, created_at, updated_at,
        initiative_scope, date_checked, match_requirements, allowable_costs, eligibility_evidence, verification_status
      ) VALUES (?, ?, ?, ?, 'researching', ?, ?, ?, ?, ?, 'aura_desk', ?, ?, 'discovered', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      oppId,
      card.title,
      card.funder,
      isRfp
        ? "Imported by Aura executive desk from official feed. Match is not eligibility. Money status is potential_funding."
        : "Foundation 990 profile — not an open RFP. Programs remain Unknown until the funder listing is checked.",
      deadline,
      card.officialLink !== "Unknown" ? card.officialLink : "",
      eligibility,
      sourceType,
      fp,
      isLive,
      fundingStatus,
      now,
      now,
      now,
      classified.initiative,
      card.dateChecked,
      card.matchRequirements,
      card.allowableCosts,
      eligibility,
      verification,
    );
    if (deadline) {
      await db.run(
        `INSERT INTO grant_deadlines (id, opportunity_id, title, due_date, deadline_type, created_at)
         VALUES (?, ?, ?, ?, 'submission', ?)`,
        grantId(),
        oppId,
        `Application deadline: ${card.title}`,
        deadline,
        now,
      );
    }
    inserted += 1;
    ids.push(oppId);
    await logGrantActivity("opportunity", oppId, "aura_desk_persist", `Research stored: ${card.title}`, actorEmail);
  }

  return { inserted, updated, skipped, ids };
}

export async function buildGrantCenterDeskSnapshot(initiative: FundingInitiative | "all" = "all") {
  await ensureGrantTables();
  const db = await getDb();
  const opps = ((await db.all("SELECT * FROM grant_opportunities ORDER BY updated_at DESC LIMIT 400").catch(() => [])) as Record<string, unknown>[])
    .map((row) => {
      const classified = classifyFundingInitiative(row);
      return {
        id: String(row.id),
        title: String(row.title ?? "Unknown"),
        funder: String(row.funder ?? "Unknown"),
        initiative: classified.initiative,
        moneyStatus: moneyStatusFromGrantRow(row),
        deadline: String(row.deadline ?? "Unknown") || "Unknown",
        officialLink: String(row.url ?? "Unknown") || "Unknown",
        eligibilityEvidence: String(row.eligibility_evidence ?? row.eligibility ?? "Unknown") || "Unknown",
        allowableCosts: String(row.allowable_costs ?? "Unknown") || "Unknown",
        matchRequirements: String(row.match_requirements ?? "Unknown") || "Unknown",
        dateChecked: String(row.date_checked ?? row.last_verified_at ?? "Unknown") || "Unknown",
        source: String(row.source_type ?? "Unknown"),
        verification: String(row.verification_status ?? "Unknown") || "Unknown",
        matchScoreDisclaimer: matchScoreDisclaimer(row.composite_score != null ? Number(row.composite_score) : null),
        missingDocuments: "Unknown until checklist is completed",
      };
    })
    .filter((row) => initiative === "all" || row.initiative === initiative || row.initiative === "shared_org");

  const byInitiative = {
    nj_programs: opps.filter((row) => row.initiative === "nj_programs"),
    detroit_initiative: opps.filter((row) => row.initiative === "detroit_initiative"),
    shared_org: opps.filter((row) => row.initiative === "shared_org"),
    unknown: opps.filter((row) => row.initiative === "unknown"),
  };

  const deadlines = ((await db.all(
    `SELECT d.id, d.title, d.due_date, d.deadline_type, d.completed, d.opportunity_id, o.initiative_scope, o.title as opportunity_title
     FROM grant_deadlines d
     LEFT JOIN grant_opportunities o ON o.id = d.opportunity_id
     WHERE COALESCE(d.completed, 0) = 0
     ORDER BY d.due_date ASC LIMIT 80`,
  ).catch(() => [])) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? "Unknown"),
    dueDate: String(row.due_date ?? "Unknown"),
    type: String(row.deadline_type ?? "Unknown"),
    opportunityId: String(row.opportunity_id ?? ""),
    initiative: classifyFundingInitiative({ title: String(row.opportunity_title ?? ""), initiative_scope: String(row.initiative_scope ?? "") }).initiative,
  }));

  const documents = ((await db.all(
    `SELECT id, name, doc_type, required, uploaded_at, opportunity_id, application_id, shared_org
     FROM grant_documents ORDER BY created_at DESC LIMIT 120`,
  ).catch(() => [])) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? "Unknown"),
    docType: String(row.doc_type ?? "Unknown"),
    required: Number(row.required ?? 1) === 1,
    uploaded: Boolean(row.uploaded_at),
    missing: Number(row.required ?? 1) === 1 && !row.uploaded_at,
    sharedOrg: Number(row.shared_org ?? 1) === 1,
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
  }));

  const applications = ((await db.all(
    `SELECT a.id, a.title, a.status, a.opportunity_id, a.founder_approval_status, a.initiative_scope, o.initiative_scope as opp_scope
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     ORDER BY a.updated_at DESC LIMIT 80`,
  ).catch(() => [])) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? "Unknown"),
    status: String(row.status ?? "draft"),
    founderApproval: String(row.founder_approval_status ?? "pending"),
    initiative: classifyFundingInitiative({
      title: String(row.title ?? ""),
      initiative_scope: String(row.initiative_scope || row.opp_scope || ""),
    }).initiative,
  }));

  return {
    store: "grant_center",
    secondBrowserStore: false,
    byInitiative,
    opportunities: opps,
    deadlines,
    documents,
    missingDocuments: documents.filter((doc) => doc.missing),
    applications,
    followUps: deadlines.map((item) => ({
      kind: "grant_deadline",
      title: item.title,
      dueDate: item.dueDate,
      initiative: item.initiative,
      detroitWorkspaceNote: item.initiative === "detroit_initiative"
        ? "Detroit parcel/site follow-ups stay in /hq/detroit — not mixed into Grant Center costs."
        : "NJ program follow-ups stay on this Grant Center record.",
    })),
  };
}

async function seedBudgetAndDraft(opts: {
  opportunityIds: string[];
  actorEmail?: string;
  prepareBudgets: boolean;
  prepareDrafts: boolean;
}) {
  const prepared: { opportunityId: string; applicationId?: string; budgetSeeded: boolean; draftQueued: boolean; error?: string }[] = [];
  if (!opts.prepareBudgets && !opts.prepareDrafts) return prepared;
  const { startGrantApplicationWorkflow } = await import("./grantIntelligenceEngine");
  const { updateWriterSection } = await import("./grantCenterEngine");
  for (const opportunityId of opts.opportunityIds.slice(0, 3)) {
    const result = await startGrantApplicationWorkflow(opportunityId, {
      actorEmail: opts.actorEmail,
      generateDrafts: Boolean(opts.prepareDrafts),
    });
    if (!result.ok || !result.applicationId) {
      prepared.push({ opportunityId, budgetSeeded: false, draftQueued: false, error: result.error ?? "workspace not started" });
      continue;
    }
    if (opts.prepareBudgets) {
      await updateWriterSection(result.applicationId, "budget_narrative", BUDGET_SKELETON, { email: opts.actorEmail });
    }
    prepared.push({
      opportunityId,
      applicationId: result.applicationId,
      budgetSeeded: Boolean(opts.prepareBudgets),
      draftQueued: Boolean(opts.prepareDrafts),
    });
  }
  return prepared;
}

export async function runGrantCenterExecutiveDesk(opts?: {
  initiative?: FundingInitiative | "all";
  persistToGrantCenter?: boolean;
  prepareBudgets?: boolean;
  prepareDrafts?: boolean;
  actorEmail?: string;
  actor?: { id?: string | null; email?: string | null; role?: string | null; isFounder?: boolean };
}) {
  const initiative = opts?.initiative && opts.initiative !== "unknown" ? opts.initiative : "all";
  const persist = opts?.persistToGrantCenter !== false;
  const actorEmail = opts?.actorEmail || AURA_OPERATOR.id;
  const preview = await previewRegionalDiscovery({ initiative });
  const persistResult = persist
    ? await persistDiscoveryCardsToGrantCenter(preview.opportunities, actorEmail)
    : { inserted: 0, updated: 0, skipped: 0, ids: [] as string[] };
  const snapshot = await buildGrantCenterDeskSnapshot(initiative);
  const hr = await buildHrStaffFundingPipeline();
  const grantsGovIds = persistResult.ids.slice(0, 3);
  const prepared = await seedBudgetAndDraft({
    opportunityIds: grantsGovIds,
    actorEmail,
    prepareBudgets: Boolean(opts?.prepareBudgets),
    prepareDrafts: Boolean(opts?.prepareDrafts),
  });
  const actor = opts?.actor ?? { email: actorEmail, isFounder: false };
  return {
    auraOperator: {
      kind: AURA_OPERATOR.kind,
      role: AURA_OPERATOR.role,
      isFounder: AURA_OPERATOR.isFounder,
      founderApprovalAllowed: founderApprovalAllowed(actor),
      execExcluded: isExcludedExecIdentity(actor),
    },
    mode: persist ? "search_and_store" : "read_only",
    writesGrantCenter: persist,
    submitsGrant: false,
    contactsFunders: false,
    acceptsAwards: false,
    purchasesProperty: false,
    commitsFunds: false,
    payrollFunded: false,
    notGuaranteedMoney: true as const,
    matchIsNotEligibility: true as const,
    initiative,
    checkedAt: preview.checkedAt,
    feeds: preview.feeds,
    connectedFeeds: connectedFeeds().map((feed) => feed.id),
    blockedFeeds: blockedFeedsWithManualPaths().map((feed) => ({
      id: feed.id,
      label: feed.label,
      officialManualPath: feed.officialManualPath,
      missingCredentialNames: feed.missingCredentialNames,
    })),
    discovery: {
      queries: preview.queries,
      liveCards: preview.opportunities.length,
    },
    persist: persistResult,
    snapshot,
    hr: {
      kpis: hr.kpis,
      payrollNote: "Payroll is not funded until a confirmed award and reviewed terms.",
    },
    prepared,
    walkthrough: walkthroughFundingLifecycle(),
  };
}

export function formatExecutiveDeskSummary(desk: Awaited<ReturnType<typeof runGrantCenterExecutiveDesk>>): string {
  const gaps = desk.hr.kpis && typeof desk.hr.kpis === "object" && "coverageGaps" in desk.hr.kpis
    ? String((desk.hr.kpis as { coverageGaps?: number }).coverageGaps)
    : "Unknown";
  const blocked = desk.blockedFeeds.map((feed) => `${feed.label} unavailable — ${feed.officialManualPath.url}`).join("; ");
  return [
    `Aura funding desk (${desk.initiative}) used the existing Grant Center store.`,
    `Live official cards: ${desk.discovery.liveCards}. Stored research inserted ${desk.persist.inserted}, updated ${desk.persist.updated}.`,
    `NJ rows ${desk.snapshot.byInitiative.nj_programs.length}; Detroit ${desk.snapshot.byInitiative.detroit_initiative.length}; shared-org ${desk.snapshot.byInitiative.shared_org.length}.`,
    `Open deadlines ${desk.snapshot.deadlines.length}. Missing required documents ${desk.snapshot.missingDocuments.length}. HR coverage gaps ${gaps}.`,
    "Match scores are not eligibility. Amounts are potential_funding until submitted_application, award, or received_revenue.",
    "Aura did not submit, contact funders or DLBA, accept awards, purchase property, or commit funds.",
    `exec@ifcdc.org cannot Founder-approve. Aura operator is AI, not Founder. Founder approval allowed for this actor: ${desk.auraOperator.founderApprovalAllowed}.`,
    blocked ? `Blocked feeds (manual research): ${blocked}` : "",
  ].filter(Boolean).join(" ");
}
