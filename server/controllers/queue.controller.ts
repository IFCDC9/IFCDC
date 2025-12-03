import { Response } from "express";
import prisma from "../db/client";
import { AuthRequest } from "../middleware/auth";

export const myQueue = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.sub;

    const submissions = await prisma.formSubmission.findMany({
      where: {
        assignedToId: userId,
        status: { in: ["open", "in_review"] },
      },
      orderBy: [
        { flagged: "desc" },
        { riskLevel: "desc" },
        { createdAt: "asc" },
      ],
      include: {
        form: { select: { id: true, slug: true, title: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.json(submissions);
  } catch (err) {
    console.error("Error fetching my queue:", err);
    res.status(500).json({ message: "Error fetching queue" });
  }
};

export const highRiskQueue = async (_req: AuthRequest, res: Response) => {
  try {
    const submissions = await prisma.formSubmission.findMany({
      where: {
        OR: [
          { riskLevel: "high" },
          { flagged: true },
        ],
        status: { in: ["open", "in_review"] },
      },
      orderBy: [
        { flagged: "desc" },
        { createdAt: "asc" },
      ],
      include: {
        form: { select: { id: true, slug: true, title: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    res.json(submissions);
  } catch (err) {
    console.error("Error fetching high-risk queue:", err);
    res.status(500).json({ message: "Error fetching high-risk queue" });
  }
};
