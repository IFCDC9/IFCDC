import { Router } from "express";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  ensureBoardPortalTables,
  buildBoardPortalOverview,
  castBoardVote,
  finalizeResolution,
  boardId,
} from "../hq/boardPortalSchema";
import { buildBoardFinancialReport } from "../hq/financeIntelligence";
import { generateBoardPackageReport } from "../hq/enterpriseReporting";
import { getOrGenerateDailyBriefing } from "../hq/executiveBriefings";

const router = Router();

router.use(hqAuthRequired);
router.use(async (_req, _res, next) => {
  try {
    await ensureBoardPortalTables();
    next();
  } catch (e) {
    next(e);
  }
});

router.get("/overview", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildBoardPortalOverview());
});

router.get("/meetings", requireHQModule("executive"), async (_req, res) => {
  const db = await getDb();
  res.json({ meetings: await db.all("SELECT * FROM board_meetings ORDER BY meeting_date DESC") });
});

router.post("/meetings", requireHQModule("executive"), async (req: Request, res: Response) => {
  const { title, meeting_date, location, status, agenda, minutes, quorum_required } = req.body;
  if (!title || !meeting_date) return res.status(400).json({ error: "title and meeting_date are required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = boardId();
  await db.run(
    `INSERT INTO board_meetings (id, title, meeting_date, location, status, agenda, minutes, quorum_required, minutes_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    id, title, meeting_date, location ?? null, status ?? "scheduled", agenda ?? null, minutes ?? null,
    quorum_required ?? 5, now
  );
  res.status(201).json({ meeting: await db.get("SELECT * FROM board_meetings WHERE id = ?", id) });
});

router.patch("/meetings/:id", requireHQModule("executive"), async (req: Request, res: Response) => {
  const db = await getDb();
  const { agenda, minutes, status, minutes_status, location } = req.body;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (agenda != null) { sets.push("agenda = ?"); vals.push(agenda); }
  if (minutes != null) { sets.push("minutes = ?"); vals.push(minutes); }
  if (status != null) { sets.push("status = ?"); vals.push(status); }
  if (minutes_status != null) { sets.push("minutes_status = ?"); vals.push(minutes_status); }
  if (location != null) { sets.push("location = ?"); vals.push(location); }
  if (!sets.length) return res.status(400).json({ error: "No fields to update" });
  vals.push(req.params.id);
  await db.run(`UPDATE board_meetings SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  res.json({ meeting: await db.get("SELECT * FROM board_meetings WHERE id = ?", req.params.id) });
});

router.get("/packets", requireHQModule("executive"), async (_req, res) => {
  const db = await getDb();
  res.json({ packets: await db.all("SELECT * FROM board_packets ORDER BY created_at DESC") });
});

router.post("/packets", requireHQModule("executive"), async (req: Request, res: Response) => {
  const { meeting_id, title, description, document_urls, executive_summary } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = boardId();
  await db.run(
    `INSERT INTO board_packets (id, meeting_id, title, description, document_urls, executive_summary, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    id, meeting_id ?? null, title, description ?? null,
    document_urls ? JSON.stringify(document_urls) : null, executive_summary ?? null, now
  );
  if (meeting_id) await db.run("UPDATE board_meetings SET packet_id = ? WHERE id = ?", id, meeting_id);
  res.status(201).json({ packet: await db.get("SELECT * FROM board_packets WHERE id = ?", id) });
});

router.post("/packets/:id/publish", requireHQModule("executive"), async (req, res) => {
  const db = await getDb();
  const now = new Date().toISOString();
  const briefing = await getOrGenerateDailyBriefing();
  const financial = await buildBoardFinancialReport();
  await db.run(
    `UPDATE board_packets SET status = 'published', published_at = ?, executive_summary = COALESCE(executive_summary, ?), financial_report_id = ? WHERE id = ?`,
    now, briefing.content.slice(0, 4000), "board-financial", req.params.id
  );
  res.json({
    packet: await db.get("SELECT * FROM board_packets WHERE id = ?", req.params.id),
    financialSummary: financial.executiveSummary,
  });
});

router.get("/resolutions", requireHQModule("executive"), async (_req, res) => {
  const db = await getDb();
  res.json({ resolutions: await db.all("SELECT * FROM board_resolutions ORDER BY created_at DESC") });
});

router.post("/resolutions", requireHQModule("executive"), async (req: Request, res: Response) => {
  const { meeting_id, title, description, resolution_text } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = boardId();
  await db.run(
    `INSERT INTO board_resolutions (id, meeting_id, title, description, resolution_text, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'proposed', ?)`,
    id, meeting_id ?? null, title, description ?? null, resolution_text ?? null, now
  );
  res.status(201).json({ resolution: await db.get("SELECT * FROM board_resolutions WHERE id = ?", id) });
});

router.post("/resolutions/:id/vote", requireHQModule("executive"), async (req: Request, res: Response) => {
  const vote = req.body.vote as "yes" | "no" | "abstain";
  if (!vote || !["yes", "no", "abstain"].includes(vote)) {
    return res.status(400).json({ error: "vote must be yes, no, or abstain" });
  }
  try {
    const result = await castBoardVote(req.params.id, { email: req.hqUser?.email ?? "", name: req.hqUser?.name }, vote);
    if (!result) return res.status(404).json({ error: "Resolution not found" });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/resolutions/:id/finalize", requireHQModule("executive"), async (req, res) => {
  const result = await finalizeResolution(req.params.id);
  if (!result) return res.status(404).json({ error: "Resolution not found" });
  res.json({ resolution: result });
});

router.get("/financial-report", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildBoardFinancialReport());
});

router.get("/governance-package", requireHQModule("executive"), async (_req, res) => {
  res.json(await generateBoardPackageReport());
});

router.get("/documents", requireHQModule("executive"), async (_req, res) => {
  const db = await getDb();
  res.json({ documents: await db.all("SELECT * FROM hq_documents WHERE access_level = 'board' ORDER BY updated_at DESC") });
});

export default router;
