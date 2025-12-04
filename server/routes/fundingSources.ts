import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

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

export default router;
