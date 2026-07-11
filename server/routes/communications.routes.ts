import { Router } from "express";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { commId } from "../hq/communicationsSchema";
import { sendHqNotification } from "../lib/notifications";
import { enqueueNotification } from "../hq/notificationQueue";

const router = Router();

router.use(hqAuthRequired, requireHQModule("notifications"));

router.get("/overview", async (_req, res) => {
  const db = await getDb();
  const announcements = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_announcements WHERE status = 'published'"))?.c ?? 0;
  const messages = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_messages"))?.c ?? 0;
  res.json({ announcements, messages });
});

router.get("/announcements", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(
    `SELECT * FROM hq_announcements WHERE status = 'published' ORDER BY published_at DESC LIMIT 50`
  );
  res.json({ announcements: rows });
});

router.post("/announcements", async (req: Request, res: Response) => {
  const { title, body, priority, expires_at } = req.body;
  if (!title || !body) return res.status(400).json({ error: "title and body are required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = commId();
  await db.run(
    `INSERT INTO hq_announcements (id, title, body, priority, author_email, author_name, published_at, expires_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
    id, title, body, priority ?? "normal", req.hqUser?.email ?? "", req.hqUser?.name ?? "HQ Admin",
    now, expires_at ?? null, now
  );
  await enqueueNotification({
    type: "announcement",
    title: `Announcement: ${title}`,
    message: body.slice(0, 500),
    priority: priority === "high" ? "high" : "normal",
    channel: "in_app",
    path: "/hq/communications",
    payload: { announcementId: id },
  });
  res.status(201).json({ announcement: await db.get("SELECT * FROM hq_announcements WHERE id = ?", id) });
});

router.get("/messages", async (req: Request, res) => {
  const db = await getDb();
  const email = req.hqUser?.email ?? "";
  const folder = String(req.query.folder ?? "inbox");
  let rows;
  if (folder === "sent") {
    rows = await db.all(
      `SELECT * FROM hq_messages WHERE from_email = ? ORDER BY created_at DESC LIMIT 50`, email
    );
  } else {
    rows = await db.all(
      `SELECT * FROM hq_messages WHERE to_email = ? ORDER BY created_at DESC LIMIT 50`, email
    );
  }
  res.json({ messages: rows });
});

router.post("/messages", async (req: Request, res: Response) => {
  const { to_email, to_name, subject, body, channel } = req.body;
  if (!to_email || !subject || !body) {
    return res.status(400).json({ error: "to_email, subject, and body are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = commId();
  await db.run(
    `INSERT INTO hq_messages (id, from_email, from_name, to_email, to_name, subject, body, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.hqUser?.email ?? "", req.hqUser?.name ?? "", to_email, to_name ?? "", subject, body, channel ?? "direct", now
  );
  res.status(201).json({ message: await db.get("SELECT * FROM hq_messages WHERE id = ?", id) });
});

router.patch("/messages/:id/read", async (req: Request, res: Response) => {
  const db = await getDb();
  const row = await db.get<{ to_email: string }>("SELECT to_email FROM hq_messages WHERE id = ?", req.params.id);
  if (!row) return res.status(404).json({ error: "Message not found" });
  if (row.to_email !== req.hqUser?.email) return res.status(403).json({ error: "Not your message" });
  const now = new Date().toISOString();
  await db.run("UPDATE hq_messages SET read_at = ? WHERE id = ?", now, req.params.id);
  res.json({ message: await db.get("SELECT * FROM hq_messages WHERE id = ?", req.params.id) });
});

const AUDIENCE_SEGMENTS: Record<string, { label: string; types: string[] }> = {
  employees: { label: "All Employees", types: ["employee", "staff", "contractor"] },
  volunteers: { label: "All Volunteers", types: ["volunteer", "mentor"] },
  board: { label: "Board Members", types: ["board_member"] },
  staff: { label: "Staff & Leadership", types: ["employee", "staff"] },
  all: { label: "All Active People", types: [] },
};

router.get("/audiences", async (_req, res) => {
  const db = await getDb();
  const counts: Record<string, number> = {};
  for (const [key, seg] of Object.entries(AUDIENCE_SEGMENTS)) {
    if (key === "all") {
      counts[key] = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE status = 'active' AND email IS NOT NULL AND email != ''"))?.c ?? 0;
    } else {
      const placeholders = seg.types.map(() => "?").join(", ");
      counts[key] = (await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM people WHERE status = 'active' AND email IS NOT NULL AND email != '' AND person_type IN (${placeholders})`,
        ...seg.types
      ))?.c ?? 0;
    }
  }
  res.json({
    segments: Object.entries(AUDIENCE_SEGMENTS).map(([id, seg]) => ({
      id,
      label: seg.label,
      count: counts[id] ?? 0,
    })),
  });
});

router.post("/broadcast-segment", async (req: Request, res: Response) => {
  const { segment, subject, body, channel } = req.body ?? {};
  if (!segment || !subject || !body) {
    return res.status(400).json({ error: "segment, subject, and body are required" });
  }
  const seg = AUDIENCE_SEGMENTS[segment as string];
  if (!seg) return res.status(400).json({ error: "Invalid audience segment" });

  const db = await getDb();
  let recipients: { email: string; first_name: string; last_name: string }[];
  if (segment === "all") {
    recipients = await db.all(
      "SELECT email, first_name, last_name FROM people WHERE status = 'active' AND email IS NOT NULL AND email != '' LIMIT 500"
    );
  } else {
    const placeholders = seg.types.map(() => "?").join(", ");
    recipients = await db.all(
      `SELECT email, first_name, last_name FROM people WHERE status = 'active' AND email IS NOT NULL AND email != '' AND person_type IN (${placeholders}) LIMIT 500`,
      ...seg.types
    );
  }

  const results = [];
  for (const r of recipients) {
    try {
      const result = await sendHqNotification({
        to: r.email,
        subject,
        body: body.replace(/\{name\}/g, `${r.first_name} ${r.last_name}`.trim()),
        channel: channel || "email",
      });
      await enqueueNotification({
        type: "campaign",
        title: subject,
        message: body.slice(0, 300),
        priority: "normal",
        channel: "in_app",
        targetEmail: r.email,
        path: "/hq/communications",
      });
      results.push({ email: r.email, ok: true, result });
    } catch {
      results.push({ email: r.email, ok: false });
    }
  }

  res.json({
    segment,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    total: recipients.length,
    results,
  });
});

router.get("/voice/live", async (_req, res) => {
  const {
    ensureAuraVoiceReliabilityTables,
    listLiveCallMonitors,
    listRecentVoiceJobs,
  } = await import("../hq/auraVoiceJobQueue");
  await ensureAuraVoiceReliabilityTables();
  const calls = listLiveCallMonitors();
  const jobs = await listRecentVoiceJobs(25);
  res.json({
    calls,
    jobs: jobs.map((j) => ({
      id: j.id,
      sessionId: j.sessionId,
      callSid: j.callSid,
      callerPhone: j.callerPhone,
      speech: j.speech,
      commandType: j.commandType,
      status: j.status,
      stage: j.stage,
      stageLabel: j.stageLabel,
      progressPercent: j.progressPercent,
      latencyMs: j.latencyMs,
      founderConfirmRequired: j.founderConfirmRequired,
      founderConfirmed: j.founderConfirmed,
      error: j.error,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      deliveredTo: j.deliveredTo,
      providerErrors: j.providerErrors,
      resultPreview: j.result?.reply?.slice(0, 400) || j.streamPartial?.slice(0, 400) || null,
    })),
    generatedAt: new Date().toISOString(),
  });
});

export default router;
