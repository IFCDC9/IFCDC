import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth(["admin", "program_staff"]), async (_req, res) => {
  try {
    const programs = await prisma.program.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.json(programs);
  } catch (err) {
    console.error("Error fetching programs", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
