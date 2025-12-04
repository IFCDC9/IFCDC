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

router.post("/", requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, code, description, location, status } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Program name is required" });
    }

    const program = await prisma.program.create({
      data: {
        name,
        code: code || null,
        description: description || null,
        location: location || null,
        status: status || "active",
      },
    });

    return res.status(201).json(program);
  } catch (err: any) {
    console.error("Error creating program", err);
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Program code already in use" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:programId/enroll", requireAuth(["admin", "program_staff"]), async (req, res) => {
  try {
    const { programId } = req.params;
    const { firstName, lastName, email, phone, notes, participantId } = req.body;

    let participant;

    if (participantId) {
      participant = await prisma.participant.findUnique({ where: { id: participantId } });
      if (!participant) {
        return res.status(400).json({ error: "Invalid participantId" });
      }
    } else {
      if (!firstName || !lastName) {
        return res.status(400).json({ error: "Participant name required" });
      }
      participant = await prisma.participant.create({
        data: {
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          notes: notes || null,
        },
      });
    }

    const enrollment = await prisma.programEnrollment.create({
      data: {
        programId,
        participantId: participant.id,
        startDate: new Date(),
        status: "active",
      },
      include: {
        participant: true,
        program: true,
      },
    });

    return res.status(201).json(enrollment);
  } catch (err) {
    console.error("Error enrolling participant", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:programId/participants", requireAuth(["admin", "program_staff"]), async (req, res) => {
  try {
    const { programId } = req.params;

    const enrollments = await prisma.programEnrollment.findMany({
      where: { programId, status: "active" },
      include: { participant: true },
      orderBy: { startDate: "desc" },
    });

    const participants = enrollments.map(e => e.participant);
    return res.json(participants);
  } catch (err) {
    console.error("Error fetching program participants", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
