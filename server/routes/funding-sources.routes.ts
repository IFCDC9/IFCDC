import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth(["admin", "barber", "radio_host", "program_staff"]), async (_req, res) => {
  try {
    const fundingSources = await prisma.fundingSource.findMany({
      orderBy: { name: "asc" },
    });
    return res.json(fundingSources);
  } catch (err) {
    console.error("Error fetching funding sources", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const fundingSource = await prisma.fundingSource.findUnique({
      where: { id },
      include: {
        programs: true,
        timeEntries: {
          include: {
            employee: true,
          },
        },
      },
    });

    if (!fundingSource) {
      return res.status(404).json({ error: "Funding source not found" });
    }

    return res.json(fundingSource);
  } catch (err) {
    console.error("Error fetching funding source", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth(["admin"]), async (req: AuthedRequest, res) => {
  try {
    const { name, code, type, agency, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const fundingSource = await prisma.fundingSource.create({
      data: {
        name,
        code: code || null,
        type: type || null,
        agency: agency || null,
        notes: notes || null,
      },
    });

    return res.status(201).json(fundingSource);
  } catch (err) {
    console.error("Error creating funding source", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireAuth(["admin"]), async (req: AuthedRequest, res) => {
  try {
    const { id } = req.params;
    const { name, code, type, agency, notes } = req.body;

    const existing = await prisma.fundingSource.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Funding source not found" });
    }

    const fundingSource = await prisma.fundingSource.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existing.name,
        code: code !== undefined ? code : existing.code,
        type: type !== undefined ? type : existing.type,
        agency: agency !== undefined ? agency : existing.agency,
        notes: notes !== undefined ? notes : existing.notes,
      },
    });

    return res.json(fundingSource);
  } catch (err) {
    console.error("Error updating funding source", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.fundingSource.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Funding source not found" });
    }

    await prisma.fundingSource.delete({ where: { id } });

    return res.json({ success: true });
  } catch (err) {
    console.error("Error deleting funding source", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
