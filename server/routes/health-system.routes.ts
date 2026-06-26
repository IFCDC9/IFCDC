import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../prisma";

const router = Router();

export const ROLES = {
  EXEC: "EXEC",
  CLINICIAN: "CLINICIAN",
  CASE_MANAGER: "CASE_MANAGER",
  CHW: "CHW",
  ADMIN: "ADMIN",
} as const;

type RoleType = typeof ROLES[keyof typeof ROLES];

declare global {
  namespace Express {
    interface Request {
      apiUser?: {
        id: string;
        name: string | null;
        role: string;
      };
    }
  }
}

async function auth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("x-api-key");
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const user = await prisma.user.findUnique({
    where: { apiKey },
    select: { id: true, name: true, role: true },
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  req.apiUser = user;
  next();
}

function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiUser) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    if (!allowedRoles.includes(req.apiUser.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

async function logAudit(
  req: Request,
  entityType: string,
  entityId: string | null,
  action: string,
  extra: Record<string, unknown> = {}
) {
  await prisma.auditLog.create({
    data: {
      userId: req.apiUser?.id || null,
      userRole: req.apiUser?.role || null,
      method: req.method,
      path: req.originalUrl,
      entityType,
      entityId,
      action,
      extra: extra as any,
    },
  });
}

router.post(
  "/users",
  auth,
  requireRole(ROLES.EXEC),
  async (req: Request, res: Response) => {
    const { name, email, role, password } = req.body;

    if (!name || !role) {
      return res.status(400).json({ error: "name and role are required" });
    }
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const apiKey = crypto.randomBytes(24).toString("hex");
    const bcrypt = await import("bcrypt");
    const passwordHash = await bcrypt.hash(password || crypto.randomBytes(12).toString("hex"), 10);
    const userEmail = email || `${name.toLowerCase().replace(/\s+/g, ".")}.${crypto.randomBytes(4).toString("hex")}@ifcdc.local`;

    try {
      const user = await prisma.user.create({
        data: {
          name,
          email: userEmail,
          role,
          apiKey,
          passwordHash,
        },
      });

      await logAudit(req, "USER", user.id, "CREATE_USER", { createdRole: role });

      res.status(201).json({
        id: user.id,
        name: user.name,
        role: user.role,
        apiKey,
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        return res.status(400).json({ error: "Email already exists" });
      }
      throw error;
    }
  }
);

router.get(
  "/users",
  auth,
  requireRole(ROLES.EXEC),
  async (req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    await logAudit(req, "USER", null, "LIST_USERS");
    res.json(users);
  }
);

router.post(
  "/clients",
  auth,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req: Request, res: Response) => {
    const { fullName, dateOfBirth, contactInfo, programs } = req.body;

    if (!fullName) {
      return res.status(400).json({ error: "fullName is required" });
    }

    const client = await prisma.patient.create({
      data: {
        fullName,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        contactInfo: contactInfo || {},
        programs: Array.isArray(programs) ? programs : [],
      },
    });

    await logAudit(req, "CLIENT", client.id, "CREATE_CLIENT");
    res.status(201).json(client);
  }
);

router.get(
  "/clients/:id",
  auth,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req: Request, res: Response) => {
    const client = await prisma.patient.findUnique({
      where: { id: req.params.id },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    await logAudit(req, "CLIENT", client.id, "VIEW_CLIENT");
    res.json(client);
  }
);

router.get(
  "/clients",
  auth,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req: Request, res: Response) => {
    const clients = await prisma.patient.findMany({
      select: {
        id: true,
        fullName: true,
        dateOfBirth: true,
        programs: true,
        createdAt: true,
      },
    });

    await logAudit(req, "CLIENT", null, "LIST_CLIENTS");
    res.json(clients);
  }
);

router.post(
  "/clients/:id/encounters",
  auth,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER, ROLES.CHW),
  async (req: Request, res: Response) => {
    const client = await prisma.patient.findUnique({
      where: { id: req.params.id },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const { program, type, summary, note } = req.body;

    if (!program || !type) {
      return res.status(400).json({
        error: "program and type are required (e.g. 'MentalHealth', 'Screening')",
      });
    }

    const encounter = await prisma.encounter.create({
      data: {
        patientId: client.id,
        program,
        type,
        summary: summary || "",
        note: note || "",
        createdById: req.apiUser!.id,
        createdByRole: req.apiUser!.role,
      },
    });

    await logAudit(req, "ENCOUNTER", encounter.id, "CREATE_ENCOUNTER", {
      clientId: client.id,
      program,
      type,
    });

    res.status(201).json(encounter);
  }
);

router.get(
  "/clients/:id/encounters",
  auth,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req: Request, res: Response) => {
    const client = await prisma.patient.findUnique({
      where: { id: req.params.id },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const encounters = await prisma.encounter.findMany({
      where: { patientId: client.id },
      orderBy: { createdAt: "desc" },
    });

    await logAudit(req, "ENCOUNTER", null, "LIST_ENCOUNTERS", {
      clientId: client.id,
      count: encounters.length,
    });

    res.json(encounters);
  }
);

router.get(
  "/audit-logs",
  auth,
  requireRole(ROLES.EXEC),
  async (req: Request, res: Response) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: "desc" },
      take: 500,
    });
    res.json(logs);
  }
);

router.post("/generate-exec-key", async (req: Request, res: Response) => {
  const { secret } = req.body;
  
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Invalid secret" });
  }

  const execUser = await prisma.user.findFirst({
    where: { role: ROLES.EXEC },
  });

  if (!execUser) {
    return res.status(404).json({ error: "No EXEC user found. Create one first." });
  }

  const apiKey = crypto.randomBytes(24).toString("hex");
  
  await prisma.user.update({
    where: { id: execUser.id },
    data: { apiKey },
  });

  res.json({
    message: "API key generated for EXEC user",
    userId: execUser.id,
    name: execUser.name,
    apiKey,
  });
});

export default router;
