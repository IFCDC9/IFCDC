import { getDb } from "../db";
import crypto from "crypto";
import { ensureGrantTables } from "./grantsSchema";

export function funderId() {
  return crypto.randomUUID();
}

export async function ensureFunderCrmTables(): Promise<void> {
  await ensureGrantTables();
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_funders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      relationship_stage TEXT DEFAULT 'prospect',
      website TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grant_funder_interactions (
      id TEXT PRIMARY KEY,
      funder_id TEXT NOT NULL,
      interaction_type TEXT DEFAULT 'note',
      subject TEXT NOT NULL,
      notes TEXT,
      interaction_date TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (funder_id) REFERENCES grant_funders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_funder_interactions_funder ON grant_funder_interactions(funder_id);
  `);

  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_funders"))?.c ?? 0;
  if (count === 0) {
    const now = new Date().toISOString();
    const distinctFunders = (await db.all(
      `SELECT DISTINCT funder FROM grant_opportunities WHERE funder IS NOT NULL AND funder != ''`
    ) as unknown) as { funder: string }[];
    for (const row of distinctFunders) {
      const fid = funderId();
      const stats = await db.get<{ awards: number; total: number }>(`
        SELECT COUNT(*) as awards, COALESCE(SUM(aw.amount), 0) as total
        FROM grant_awards aw
        JOIN grant_opportunities o ON o.id = aw.opportunity_id
        WHERE o.funder = ? AND aw.status = 'active'`, row.funder);
      const stage = (stats?.awards ?? 0) > 0 ? "active_partner" : "prospect";
      await db.run(
        `INSERT OR IGNORE INTO grant_funders (id, name, relationship_stage, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        fid, row.funder, stage,
        (stats?.awards ?? 0) > 0 ? `${stats?.awards} active award(s) · $${(stats?.total ?? 0).toLocaleString()} total` : "",
        now, now
      );
    }
  }
}

export async function listFunders(opts?: { stage?: string; q?: string }) {
  await ensureFunderCrmTables();
  const db = await getDb();
  let sql = "SELECT * FROM grant_funders WHERE 1=1";
  const params: unknown[] = [];
  if (opts?.stage) { sql += " AND relationship_stage = ?"; params.push(opts.stage); }
  if (opts?.q) { sql += " AND (name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ?)"; params.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`); }
  sql += " ORDER BY name ASC";
  const funders = (await db.all(sql, ...params) as unknown) as Record<string, unknown>[];

  const enriched = await Promise.all(funders.map(async (f) => {
    const stats = await db.get<{ awards: number; total: number; pipeline: number }>(`
      SELECT
        (SELECT COUNT(*) FROM grant_awards aw JOIN grant_opportunities o ON o.id = aw.opportunity_id WHERE o.funder = ? AND aw.status = 'active') as awards,
        (SELECT COALESCE(SUM(aw.amount), 0) FROM grant_awards aw JOIN grant_opportunities o ON o.id = aw.opportunity_id WHERE o.funder = ?) as total,
        (SELECT COUNT(*) FROM grant_opportunities WHERE funder = ? AND status = 'open') as pipeline`);
    const interactions = (await db.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM grant_funder_interactions WHERE funder_id = ?", String(f.id)
    ))?.c ?? 0;
    return { ...f, activeAwards: stats?.awards ?? 0, totalAwarded: stats?.total ?? 0, openOpportunities: stats?.pipeline ?? 0, interactionCount: interactions };
  }));

  return enriched;
}

export async function getFunder(id: string) {
  await ensureFunderCrmTables();
  const db = await getDb();
  const funder = await db.get("SELECT * FROM grant_funders WHERE id = ?", id);
  if (!funder) return null;
  const name = (funder as { name: string }).name;
  const [opportunities, awards, interactions, compliance] = await Promise.all([
    db.all("SELECT id, title, status, deadline, amount_max FROM grant_opportunities WHERE funder = ? ORDER BY deadline ASC", name),
    db.all(`SELECT aw.id, aw.amount, aw.status, aw.award_date, o.title FROM grant_awards aw
      JOIN grant_opportunities o ON o.id = aw.opportunity_id WHERE o.funder = ? ORDER BY aw.award_date DESC`, name),
    db.all("SELECT * FROM grant_funder_interactions WHERE funder_id = ? ORDER BY interaction_date DESC LIMIT 20", id),
    db.all(`SELECT c.id, c.report_type, c.due_date, c.status, o.title FROM grant_compliance c
      JOIN grant_awards aw ON aw.id = c.award_id JOIN grant_opportunities o ON o.id = aw.opportunity_id
      WHERE o.funder = ? AND c.status = 'pending' ORDER BY c.due_date ASC`, name),
  ]);
  return { funder, opportunities, awards, interactions, complianceDue: compliance };
}

export async function createFunder(input: {
  name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  relationship_stage?: string;
  website?: string;
  address?: string;
  notes?: string;
}) {
  await ensureFunderCrmTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const fid = funderId();
  await db.run(
    `INSERT INTO grant_funders (id, name, contact_name, contact_email, contact_phone, relationship_stage, website, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    fid, input.name, input.contact_name ?? null, input.contact_email ?? null, input.contact_phone ?? null,
    input.relationship_stage ?? "prospect", input.website ?? null, input.address ?? null, input.notes ?? null, now, now
  );
  return db.get("SELECT * FROM grant_funders WHERE id = ?", fid);
}

export async function updateFunder(id: string, input: Partial<{
  name: string; contact_name: string; contact_email: string; contact_phone: string;
  relationship_stage: string; website: string; address: string; notes: string;
}>) {
  await ensureFunderCrmTables();
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (!sets.length) return null;
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), id);
  await db.run(`UPDATE grant_funders SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  return db.get("SELECT * FROM grant_funders WHERE id = ?", id);
}

export async function logFunderInteraction(funderId: string, input: {
  interaction_type?: string;
  subject: string;
  notes?: string;
  interaction_date?: string;
  created_by?: string;
}) {
  await ensureFunderCrmTables();
  const db = await getDb();
  const iid = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO grant_funder_interactions (id, funder_id, interaction_type, subject, notes, interaction_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    iid, funderId, input.interaction_type ?? "note", input.subject, input.notes ?? "",
    input.interaction_date ?? now.slice(0, 10), input.created_by ?? null, now
  );
  await db.run("UPDATE grant_funders SET updated_at = ? WHERE id = ?", now, funderId);
  return db.get("SELECT * FROM grant_funder_interactions WHERE id = ?", iid);
}

export async function buildFunderCrmDashboard() {
  const funders = await listFunders();
  const stages = ["prospect", "cultivating", "active_partner", "lapsed"];
  const byStage = stages.map((stage) => ({
    stage,
    count: funders.filter((f) => String((f as unknown as Record<string, unknown>).relationship_stage ?? "") === stage).length,
  }));
  return {
    totalFunders: funders.length,
    activePartners: funders.filter((f) => String((f as unknown as Record<string, unknown>).relationship_stage ?? "") === "active_partner").length,
    totalAwarded: funders.reduce((s, f) => s + Number((f as { totalAwarded?: number }).totalAwarded ?? 0), 0),
    byStage,
    funders: funders.slice(0, 50),
    timestamp: new Date().toISOString(),
  };
}
