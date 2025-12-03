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
      orderBy: { createdAt: "desc" },
      include: {
        form: { select: { slug: true, title: true } },
        submittedBy: { select: { id: true, name: true } },
      },
    });

    res.json(submissions);
  } catch (err) {
    console.error("Error fetching supervisor queue:", err);
    res.status(500).json({ message: "Error fetching queue" });
  }
};

export const highRiskQueue = async (_req: AuthRequest, res: Response) => {
  try {
    const incidentForm = await prisma.form.findUnique({
      where: { slug: "incident_report" },
      select: { id: true },
    });

    if (!incidentForm) return res.json([]);

    const submissions = await prisma.formSubmission.findMany({
      where: {
        formId: incidentForm.id,
        riskLevel: "high",
        status: { in: ["open", "in_review"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        submittedBy: { select: { id: true, name: true } },
      },
    });

    res.json(submissions);
  } catch (err) {
    console.error("Error fetching high-risk queue:", err);
    res.status(500).json({ message: "Error fetching high-risk items" });
  }
};
