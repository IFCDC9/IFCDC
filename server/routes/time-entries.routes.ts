import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

router.post(
  "/",
  requireAuth(["admin", "barber", "radio_host", "program_staff"]),
  async (req: AuthedRequest, res) => {
    try {
      const { date, hours, programId, notes } = req.body;

      if (!req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!date || !hours) {
        return res.status(400).json({ error: "Date and hours are required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true },
      });

      if (!user || !user.employee) {
        return res
          .status(400)
          .json({ error: "User is not linked to an employee record" });
      }

      const entry = await prisma.timeEntry.create({
        data: {
          employeeId: user.employee.id,
          programId: programId || null,
          date: new Date(date),
          hours: parseFloat(hours),
          notes: notes || null,
        },
        include: {
          program: true,
        },
      });

      return res.status(201).json(entry);
    } catch (err) {
      console.error("Error creating time entry", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/my",
  requireAuth(["admin", "barber", "radio_host", "program_staff"]),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true },
      });

      if (!user || !user.employee) {
        return res
          .status(400)
          .json({ error: "User is not linked to an employee record" });
      }

      const entries = await prisma.timeEntry.findMany({
        where: { employeeId: user.employee.id },
        include: { program: true },
        orderBy: { date: "desc" },
      });

      return res.json(entries);
    } catch (err) {
      console.error("Error fetching my time entries", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/", requireAuth(["admin"]), async (_req, res) => {
  try {
    const entries = await prisma.timeEntry.findMany({
      include: {
        employee: true,
        program: true,
      },
      orderBy: { date: "desc" },
    });

    return res.json(entries);
  } catch (err) {
    console.error("Error fetching all time entries", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
