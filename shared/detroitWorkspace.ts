export const DETROIT_RECORD_TYPES = [
  "property",
  "checklist",
  "comparison",
  "site_note",
  "work_plan",
  "budget",
  "contact",
  "application",
  "follow_up",
] as const;

export type DetroitRecordType = (typeof DETROIT_RECORD_TYPES)[number];

export const DETROIT_TYPE_LABELS: Record<DetroitRecordType, string> = {
  property: "Available properties",
  checklist: "Eligibility & checklist",
  comparison: "Lot comparison",
  site_note: "Site notes",
  work_plan: "Work plans",
  budget: "Budget estimates",
  contact: "Contacts",
  application: "Applications",
  follow_up: "Follow-ups",
};

export const DETROIT_STATUSES = [
  "Researching",
  "Needs verification",
  "Draft",
  "Ready for review",
  "In progress",
  "Waiting",
  "Complete",
] as const;

export const DETROIT_VERIFICATION = [
  "Unknown",
  "Unverified",
  "Official source checked",
  "Confirmed by source",
] as const;

export const UNKNOWN_UNTIL_VERIFIED = "Unknown";

export type DetroitFieldKind = "text" | "textarea" | "date" | "url" | "select";

export type DetroitField = {
  key: string;
  label: string;
  kind: DetroitFieldKind;
  placeholder?: string;
  options?: readonly string[];
};

const UNKNOWN_SELECT = ["Unknown", "Unverified", "Yes", "No"] as const;
const CHECK_RESULT = ["Unknown", "Unverified", "Met", "Not met", "Not applicable"] as const;
const CERTAINTY = ["Unknown", "Rough estimate", "Quoted", "Verified"] as const;
const ELIGIBILITY = ["Unknown", "Unverified", "Appears eligible", "Appears ineligible"] as const;
const AVAILABILITY = ["Unknown", "Unverified", "Open", "Closed", "Rolling"] as const;

export const DETROIT_FIELDS: Record<DetroitRecordType, DetroitField[]> = {
  property: [
    { key: "address", label: "Street address", kind: "text", placeholder: "Leave blank until known" },
    { key: "parcelId", label: "Parcel / inventory ID", kind: "text", placeholder: "DLBA or city ID if listed" },
    { key: "listingUrl", label: "Listing URL", kind: "url", placeholder: "Official listing when available" },
    { key: "askingPrice", label: "Listed price", kind: "text", placeholder: "Unknown until verified" },
    { key: "lotSize", label: "Lot size", kind: "text", placeholder: "Unknown until verified" },
    { key: "zoning", label: "Zoning", kind: "text", placeholder: "Unknown until verified" },
    { key: "ownership", label: "Listed owner / program", kind: "text", placeholder: "e.g. DLBA — unverified" },
    { key: "restrictions", label: "Restrictions / side-lot rules", kind: "textarea", placeholder: "Unknown until the official source is checked" },
    { key: "readiness", label: "Site readiness", kind: "textarea", placeholder: "Access, utilities, demolition — unknown until visited" },
    { key: "notes", label: "Notes / next step", kind: "textarea", placeholder: "Keep missing facts marked Unknown" },
  ],
  checklist: [
    { key: "relatedProperty", label: "Related property", kind: "text" },
    { key: "item", label: "Requirement", kind: "text", placeholder: "e.g. adjacent owner, non-profit use" },
    { key: "evidence", label: "Evidence / source", kind: "textarea", placeholder: "What was checked, or Unknown" },
    { key: "checkedDate", label: "Date checked", kind: "date" },
    { key: "result", label: "Result", kind: "select", options: CHECK_RESULT },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
  comparison: [
    { key: "lotA", label: "Lot A", kind: "text" },
    { key: "lotB", label: "Lot B", kind: "text" },
    { key: "criteria", label: "Criteria compared", kind: "textarea", placeholder: "Price, size, restrictions, program fit" },
    { key: "lotANotes", label: "Lot A notes", kind: "textarea" },
    { key: "lotBNotes", label: "Lot B notes", kind: "textarea" },
    { key: "preference", label: "Working preference", kind: "text", placeholder: "None until verified" },
    { key: "unknowns", label: "Still unknown", kind: "textarea" },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
  site_note: [
    { key: "relatedProperty", label: "Related property", kind: "text" },
    { key: "visitDate", label: "Visit date", kind: "date" },
    { key: "condition", label: "Condition observed", kind: "textarea" },
    { key: "access", label: "Access / safety", kind: "textarea" },
    { key: "neighbors", label: "Neighbor / block notes", kind: "textarea" },
    { key: "photosNote", label: "Photo log (no files here)", kind: "textarea", placeholder: "Describe photos stored elsewhere" },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
  work_plan: [
    { key: "relatedProperty", label: "Related property", kind: "text" },
    { key: "phase", label: "Phase", kind: "text", placeholder: "Site control, rehab, program launch" },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "startDate", label: "Target start", kind: "date" },
    { key: "endDate", label: "Target end", kind: "date" },
    { key: "tasks", label: "Tasks", kind: "textarea" },
    { key: "dependencies", label: "Dependencies", kind: "textarea" },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
  budget: [
    { key: "relatedProperty", label: "Related property", kind: "text" },
    { key: "category", label: "Cost category", kind: "text", placeholder: "Acquisition, rehab, staffing, operations" },
    { key: "estimatedAmount", label: "Amount", kind: "text", placeholder: "Unknown until verified — do not invent" },
    { key: "fundingSource", label: "Possible funding source", kind: "text", placeholder: "Unknown until matched in Grant Center" },
    { key: "certainty", label: "Certainty", kind: "select", options: CERTAINTY },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
  contact: [
    { key: "name", label: "Name", kind: "text" },
    { key: "role", label: "Role", kind: "text" },
    { key: "organization", label: "Organization", kind: "text" },
    { key: "email", label: "Email", kind: "text" },
    { key: "phone", label: "Phone", kind: "text" },
    { key: "relatedProperty", label: "Related property", kind: "text" },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
  application: [
    { key: "relatedProperty", label: "Related property / program", kind: "text" },
    { key: "funder", label: "Funder", kind: "text", placeholder: "Required before saving to Grant Center" },
    { key: "grantCenterOpportunityId", label: "Grant Center opportunity ID", kind: "text", placeholder: "Paste an existing HQ grant id" },
    { key: "grantCenterApplicationId", label: "Grant Center application ID", kind: "text" },
    { key: "checkedDate", label: "Source checked date", kind: "date" },
    { key: "eligibilityStatus", label: "Eligibility", kind: "select", options: ELIGIBILITY },
    { key: "availabilityStatus", label: "Availability", kind: "select", options: AVAILABILITY },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
  follow_up: [
    { key: "relatedProperty", label: "Related record", kind: "text" },
    { key: "dueDate", label: "Due date", kind: "date" },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "action", label: "Action", kind: "textarea" },
    { key: "waitingOn", label: "Waiting on", kind: "text" },
    { key: "blocker", label: "Blocker", kind: "select", options: UNKNOWN_SELECT },
    { key: "notes", label: "Notes / next step", kind: "textarea" },
  ],
};

export type DetroitDraft = {
  id?: string;
  type: DetroitRecordType;
  title: string;
  status?: string;
  verificationStatus?: string;
  sourceUrl?: string | null;
  payload?: Record<string, unknown>;
};

export type DetroitPublicRecord = {
  id: string;
  type: DetroitRecordType;
  title: string;
  status: string;
  verificationStatus: string;
  sourceUrl: string | null;
  payload: Record<string, string>;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isDetroitRecordType(value: unknown): value is DetroitRecordType {
  return typeof value === "string" && (DETROIT_RECORD_TYPES as readonly string[]).includes(value);
}

export function stringifyPayload(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value == null) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text.trim()) continue;
    out[key.slice(0, 80)] = text.slice(0, 4000);
  }
  return out;
}

export function applyUnknownDefaults(type: DetroitRecordType, payload: Record<string, string>): Record<string, string> {
  const next = { ...payload };
  for (const field of DETROIT_FIELDS[type]) {
    if (field.kind === "select" && !next[field.key]) next[field.key] = UNKNOWN_UNTIL_VERIFIED;
  }
  if (type === "application") {
    if (!next.eligibilityStatus) next.eligibilityStatus = UNKNOWN_UNTIL_VERIFIED;
    if (!next.availabilityStatus) next.availabilityStatus = UNKNOWN_UNTIL_VERIFIED;
  }
  if (type === "budget" && !next.certainty) next.certainty = UNKNOWN_UNTIL_VERIFIED;
  return next;
}

export function fingerprintRecord(record: {
  type: string;
  title: string;
  sourceUrl?: string | null;
  payload?: Record<string, string>;
}): string {
  const payload = record.payload ?? {};
  const identity = [
    payload.parcelId,
    payload.address,
    payload.relatedProperty,
    payload.lotA,
    payload.item,
    payload.name,
    payload.grantCenterOpportunityId,
  ].find((value) => value?.trim()) ?? "";
  return [
    record.type.trim().toLowerCase(),
    record.title.trim().toLowerCase(),
    identity.trim().toLowerCase(),
    (record.sourceUrl ?? "").trim().toLowerCase(),
  ].join("|");
}

export function planDetroitImport(
  existing: Array<{ type: string; title: string; sourceUrl?: string | null; payload?: Record<string, string> }>,
  incoming: DetroitDraft[],
): { toInsert: DetroitDraft[]; skippedDuplicates: DetroitDraft[]; invalid: { reason: string; draft: unknown }[] } {
  const seen = new Set(existing.map((record) => fingerprintRecord({
    type: record.type,
    title: record.title,
    sourceUrl: record.sourceUrl,
    payload: record.payload ?? {},
  })));
  const toInsert: DetroitDraft[] = [];
  const skippedDuplicates: DetroitDraft[] = [];
  const invalid: { reason: string; draft: unknown }[] = [];
  for (const draft of incoming) {
    if (!draft || typeof draft !== "object") {
      invalid.push({ reason: "Not an object", draft });
      continue;
    }
    if (!isDetroitRecordType(draft.type)) {
      invalid.push({ reason: "Unsupported record type", draft });
      continue;
    }
    const title = typeof draft.title === "string" ? draft.title.trim() : "";
    if (!title || title.length > 180) {
      invalid.push({ reason: "Title must be 1 to 180 characters", draft });
      continue;
    }
    const payload = applyUnknownDefaults(draft.type, stringifyPayload(draft.payload));
    const normalized: DetroitDraft = {
      type: draft.type,
      title,
      status: typeof draft.status === "string" && draft.status.trim() ? draft.status.slice(0, 80) : "Needs verification",
      verificationStatus: typeof draft.verificationStatus === "string" && draft.verificationStatus.trim()
        ? draft.verificationStatus.slice(0, 80)
        : UNKNOWN_UNTIL_VERIFIED,
      sourceUrl: typeof draft.sourceUrl === "string" ? draft.sourceUrl.slice(0, 1000) : null,
      payload,
    };
    const key = fingerprintRecord({
      type: normalized.type,
      title: normalized.title,
      sourceUrl: normalized.sourceUrl,
      payload,
    });
    if (seen.has(key)) {
      skippedDuplicates.push(normalized);
      continue;
    }
    seen.add(key);
    toInsert.push(normalized);
  }
  return { toInsert, skippedDuplicates, invalid };
}

const SITE_KEY = /detroit|dlba|land[-_]?bank|ifcdc-detroit/i;
const TYPE_ALIASES: Record<string, DetroitRecordType> = {
  properties: "property",
  property: "property",
  lots: "property",
  checklists: "checklist",
  checklist: "checklist",
  eligibility: "checklist",
  comparisons: "comparison",
  comparison: "comparison",
  notes: "site_note",
  site_notes: "site_note",
  siteNotes: "site_note",
  work_plans: "work_plan",
  workPlans: "work_plan",
  budgets: "budget",
  budget: "budget",
  contacts: "contact",
  contact: "contact",
  applications: "application",
  application: "application",
  grants: "application",
  follow_ups: "follow_up",
  followUps: "follow_up",
};

function asDraft(value: unknown, fallbackType?: DetroitRecordType): DetroitDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const typeRaw = row.type ?? row.record_type ?? row.recordType ?? fallbackType;
  if (!isDetroitRecordType(typeRaw)) return null;
  const title = String(row.title ?? row.name ?? row.address ?? row.item ?? "").trim();
  if (!title) return null;
  const nested = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "type", "record_type", "recordType", "title", "status", "verificationStatus", "verification_status", "sourceUrl", "source_url", "payload"].includes(key)));
  return {
    type: typeRaw,
    title,
    status: typeof row.status === "string" ? row.status : undefined,
    verificationStatus: typeof row.verificationStatus === "string"
      ? row.verificationStatus
      : typeof row.verification_status === "string" ? row.verification_status : UNKNOWN_UNTIL_VERIFIED,
    sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : typeof row.source_url === "string" ? row.source_url : undefined,
    payload: nested,
  };
}

export function extractDetroitDrafts(value: unknown): DetroitDraft[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => asDraft(item)).filter((item): item is DetroitDraft => Boolean(item));
  }
  if (typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.records)) return extractDetroitDrafts(object.records);
  const drafts: DetroitDraft[] = [];
  const direct = asDraft(object);
  if (direct) drafts.push(direct);
  for (const [key, nested] of Object.entries(object)) {
    const aliased = TYPE_ALIASES[key];
    if (aliased && Array.isArray(nested)) {
      for (const item of nested) {
        const draft = asDraft(item, aliased);
        if (draft) drafts.push(draft);
      }
    }
  }
  return drafts;
}

export function scanBrowserStorage(storage: { length: number; key(index: number): string | null; getItem(key: string): string | null }): {
  matchedKeys: string[];
  drafts: DetroitDraft[];
} {
  const matchedKeys: string[] = [];
  const drafts: DetroitDraft[] = [];
  const limit = Math.min(storage.length, 400);
  for (let index = 0; index < limit; index += 1) {
    const key = storage.key(index);
    if (!key || !SITE_KEY.test(key)) continue;
    matchedKeys.push(key);
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      drafts.push(...extractDetroitDrafts(JSON.parse(raw)));
    } catch {
      // Non-JSON Site leftovers are ignored; HQ records are not discarded.
    }
  }
  return { matchedKeys, drafts };
}

export function detroitGrantHaystack(opportunity: {
  title?: string | null;
  funder?: string | null;
  description?: string | null;
  geography?: string | null;
  program_areas?: string[] | null;
}): string {
  return [
    opportunity.title,
    opportunity.funder,
    opportunity.description,
    opportunity.geography,
    ...(opportunity.program_areas ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function isDetroitRelatedGrant(opportunity: {
  title?: string | null;
  funder?: string | null;
  description?: string | null;
  geography?: string | null;
  program_areas?: string[] | null;
}): boolean {
  const haystack = detroitGrantHaystack(opportunity);
  return /detroit|wayne county|dlba|land bank|michigan/.test(haystack);
}

export const DETROIT_AURA_LIVE_SEARCH = false;

export function grantCenterResearchPayload(record: {
  title: string;
  sourceUrl?: string | null;
  payload: Record<string, string>;
}): {
  title: string;
  funder: string;
  description: string;
  url: string;
  eligibility: string;
  geography: string;
  source_type: string;
  initiative_scope: "detroit_initiative";
  verification_status: string;
  eligibility_evidence: string;
} | null {
  const funder = record.payload.funder?.trim();
  if (!funder) return null;
  return {
    title: record.title,
    funder,
    description: [
      record.payload.notes,
      "Eligibility and availability remain Unknown until verified in Grant Center.",
      "This research item was saved from the Detroit HQ workspace. Aura is not running a live Detroit grant search from this save action.",
    ].filter(Boolean).join("\n"),
    url: record.sourceUrl || record.payload.listingUrl || "",
    eligibility: record.payload.eligibilityStatus || UNKNOWN_UNTIL_VERIFIED,
    geography: "Detroit, Michigan — unverified",
    source_type: "detroit_workspace_research",
    initiative_scope: "detroit_initiative",
    verification_status: UNKNOWN_UNTIL_VERIFIED,
    eligibility_evidence: record.payload.eligibilityStatus || UNKNOWN_UNTIL_VERIFIED,
  };
}
