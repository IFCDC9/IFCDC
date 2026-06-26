import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

// List all funding sources
router.get("/", requireAuth(["admin"]), async (_req, res) => {
  try {
    const sources = await prisma.fundingSource.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.json(sources);
  } catch (err) {
    console.error("Error fetching funding sources", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create new funding source
router.post("/", requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, code, type, agency, notes } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const fs = await prisma.fundingSource.create({
      data: {
        name,
        code: code || null,
        type: type || null,
        agency: agency || null,
        notes: notes || null,
      },
    });

    return res.status(201).json(fs);
  } catch (err: any) {
    console.error("Error creating funding source", err);
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Code already in use" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Update funding source
router.patch("/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, type, agency, notes } = req.body;

    const updated = await prisma.fundingSource.update({
      where: { id },
      data: {
        name,
        code,
        type,
        agency,
        notes,
      },
    });

    return res.json(updated);
  } catch (err: any) {
    console.error("Error updating funding source", err);
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Funding source not found" });
    }
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Code already in use" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Delete funding source (only if not in use ideally)
router.delete("/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;

    // Optional safety check: is it in use?
    const inUse = await prisma.timeEntry.count({
      where: { fundingSourceId: id },
    });
    if (inUse > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete funding source; it is already in use." });
    }

    await prisma.fundingSource.delete({ where: { id } });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Error deleting funding source", err);
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Funding source not found" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
