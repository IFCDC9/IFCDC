import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

/**
 * GET /api/barber/schedule
 * Query: dateFrom, dateTo (YYYY-MM-DD, optional)
 * Returns appointments for the logged-in barber.
 */
router.get(
  "/schedule",
  requireAuth(["barber", "admin"]),
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
          .json({ error: "User is not linked to a barber/employee record" });
      }

      const { dateFrom, dateTo } = req.query as {
        dateFrom?: string;
        dateTo?: string;
      };

      const where: any = {
        barberId: user.employee.id,
      };

      if (dateFrom || dateTo) {
        where.startTime = {};
        if (dateFrom) {
          where.startTime.gte = new Date(dateFrom);
        }
        if (dateTo) {
          const dt = new Date(dateTo);
          dt.setHours(23, 59, 59, 999);
          where.startTime.lte = dt;
        }
      }

      const appointments = await prisma.appointment.findMany({
        where,
        include: {
          client: true,
        },
        orderBy: { startTime: "asc" },
      });

      return res.json(appointments);
    } catch (err) {
      console.error("Error fetching barber schedule", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * PATCH /api/barber/appointments/:id/status
 * Barber can mark an appointment as completed / cancelled / no_show.
 */
router.patch(
  "/appointments/:id/status",
  requireAuth(["barber", "admin"]),
  async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body as { status: string };

      if (!["scheduled", "completed", "cancelled", "no_show"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      if (!req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true },
      });
      if (!user || !user.employee) {
        return res.status(400).json({ error: "No employee record found" });
      }

      const appt = await prisma.appointment.findUnique({
        where: { id },
      });

      if (!appt) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      if (req.user.role === "barber" && appt.barberId !== user.employee.id) {
        return res.status(403).json({ error: "Not allowed to update this appointment" });
      }

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          status,
        },
      });

      return res.json(updated);
    } catch (err) {
      console.error("Error updating appointment status", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
