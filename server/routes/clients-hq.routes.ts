import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule, requireHQPermission } from "../middleware/hqAuth";
import {
  buildClientCaseOverview,
  buildClientCaseExecutiveSummary,
  listClientsForUser,
  getClientDetail,
  getClientSummary,
  listAppointmentsForUser,
  linkClientToPeopleRegistry,
} from "../hq/clientCaseEngine";
import { logHqAudit } from "../hq/hqAuditLog";

const router = Router();

router.use(hqAuthRequired, requireHQModule("clients"));

router.get("/platform", async (_req, res) => {
  res.json({
    module: "clients",
    version: "m2.1",
    capabilities: ["client_registry", "case_assignments", "goals", "assessments", "appointments", "people_bridge", "executive_reporting"],
    legacyApi: "/api/clients",
    generatedAt: new Date().toISOString(),
  });
});

router.get("/overview", async (_req, res) => {
  res.json(await buildClientCaseOverview());
});

router.get("/executive-summary", requireHQPermission("hq.executive", "hq.analytics"), async (_req, res) => {
  res.json(await buildClientCaseExecutiveSummary());
});

router.get("/", async (req: Request, res: Response) => {
  const program = String(req.query.program || "").trim();
  let clients = await listClientsForUser(req.hqUser!);
  if (program) {
    clients = clients.filter((c) => (c.programs as string[]).some((p) => p.toUpperCase().includes(program.toUpperCase())));
  }
  res.json({ clients, count: clients.length });
});

router.get("/appointments", async (req: Request, res: Response) => {
  let { from, to } = req.query as { from?: string; to?: string };
  const now = new Date();
  if (!from) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    from = start.toISOString();
  }
  if (!to) {
    const end = new Date(now);
    end.setDate(end.getDate() + 14);
    to = end.toISOString();
  }
  const appointments = await listAppointmentsForUser(req.hqUser!, from, to);
  res.json({ appointments, from, to });
});

router.get("/:id/summary", async (req, res) => {
  const summary = await getClientSummary(req.params.id, req.hqUser!);
  if (!summary) return res.status(403).json({ error: "Forbidden" });
  res.json(summary);
});

router.post("/:id/link-people", requireHQPermission("hq.clients.manage"), async (req: Request, res: Response) => {
  const result = await linkClientToPeopleRegistry(req.params.id, req.hqUser?.email);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

router.get("/:id", async (req, res) => {
  const client = await getClientDetail(req.params.id, req.hqUser!);
  if (!client) return res.status(404).json({ error: "Client not found" });
  res.json(client);
});

router.post("/", requireHQPermission("hq.clients.manage"), async (req: Request, res: Response) => {
  const { getDb } = await import("../db");
  const { fullName, dateOfBirth, contactInfo, programs } = req.body || {};
  if (!fullName) return res.status(400).json({ error: "fullName is required" });

  const db = await getDb();
  const id = `id_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  const created_at = new Date().toISOString();
  const phone = contactInfo?.phone || null;
  const email = contactInfo?.email || null;
  const programsJson = JSON.stringify(Array.isArray(programs) ? programs : []);

  await db.run(
    `INSERT INTO clients (id, full_name, date_of_birth, phone, email, programs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    fullName,
    dateOfBirth || null,
    phone,
    email,
    programsJson,
    created_at,
  );
  await db.run(
    `INSERT INTO client_assignments (id, client_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    `id_${Math.random().toString(36).slice(2, 10)}`,
    id,
    req.hqUser!.id,
    req.hqUser!.role,
    created_at,
  );

  await logHqAudit({
    action: "CREATE_CLIENT",
    entityType: "client",
    entityId: id,
    actorEmail: req.hqUser?.email,
    metadata: { fullName },
  });

  const peopleLink = await linkClientToPeopleRegistry(id, req.hqUser?.email).catch(() => null);

  res.status(201).json({
    id,
    fullName,
    dateOfBirth,
    contactInfo: { phone, email },
    programs: JSON.parse(programsJson),
    createdAt: created_at,
    peopleLink: peopleLink?.ok ? { personId: peopleLink.personId, linked: peopleLink.linked } : undefined,
  });
});

export default router;
