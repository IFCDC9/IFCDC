import { Response } from "express";
import prisma from "../db/client";
import { AuthRequest } from "../middleware/auth";

export const listForms = async (_req: AuthRequest, res: Response) => {
  try {
    const forms = await prisma.form.findMany({
      where: { active: true },
      select: {
        id: true,
        slug: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { slug: 'asc' },
    });

    res.json(forms);
  } catch (err) {
    console.error('Error listing forms:', err);
    res.status(500).json({ message: 'Error fetching forms' });
  }
};

export const getFormBySlug = async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const form = await prisma.form.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        schema: true,
      },
    });

    if (!form) {
      return res.status(404).json({ message: 'Form not found' });
    }

    res.json(form.schema);
  } catch (err) {
    console.error('Error fetching form:', err);
    res.status(500).json({ message: 'Error fetching form' });
  }
};

export const submitForm = async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const payload = req.body || {};
    const user = req.user || null;

    const form = await prisma.form.findUnique({
      where: { slug },
      select: { id: true, slug: true, title: true, schema: true, active: true },
    });

    if (!form || !form.active) {
      return res.status(404).json({ message: 'Form not available' });
    }

    let riskLevel = "low";
    let flagged = false;

    if (slug === "incident_report") {
      const types = payload.incident_type || [];
      const injuries = payload.injuries || "none";
      const law = payload.law_enforcement_involved || "no";

      const isWeapons = Array.isArray(types) && types.includes("weapons_related");
      const isSeriousInjury = injuries === "serious";
      const isSelfHarm = Array.isArray(types) && types.includes("self_harm_concern");

      if (isWeapons || isSeriousInjury || isSelfHarm || law === "yes") {
        riskLevel = "high";
        flagged = true;
      } else if (injuries === "minor" || law === "yes" || (Array.isArray(types) && types.includes("physical_altercation"))) {
        riskLevel = "medium";
      }
    }

    const submission = await prisma.formSubmission.create({
      data: {
        formId: form.id,
        submittedById: user ? user.sub : null,
        data: payload,
        riskLevel,
        flagged,
        status: "open",
      },
    });

    res.status(201).json({
      message: 'Form submitted successfully',
      submissionId: submission.id,
      riskLevel,
      flagged,
    });
  } catch (err) {
    console.error('Error submitting form:', err);
    res.status(500).json({ message: 'Error submitting form' });
  }
};

export const listSubmissionsForForm = async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    const form = await prisma.form.findUnique({
      where: { slug },
      select: { id: true, title: true },
    });

    if (!form) {
      return res.status(404).json({ message: 'Form not found' });
    }

    const submissions = await prisma.formSubmission.findMany({
      where: { formId: form.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        submittedById: true,
        data: true,
      },
    });

    res.json({
      form: {
        id: form.id,
        slug,
        title: form.title,
      },
      submissions,
    });
  } catch (err) {
    console.error('Error listing submissions:', err);
    res.status(500).json({ message: 'Error fetching submissions' });
  }
};

export const getSubmissionById = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    const submission = await prisma.formSubmission.findUnique({
      where: { id },
      include: {
        form: {
          select: { id: true, slug: true, title: true },
        },
        submittedBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    res.json(submission);
  } catch (err) {
    console.error('Error fetching submission:', err);
    res.status(500).json({ message: 'Error fetching submission' });
  }
};

export const updateSubmissionStatus = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;

    const validStatuses = ["open", "in_review", "resolved", "closed"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` 
      });
    }

    const submission = await prisma.formSubmission.findUnique({
      where: { id },
    });

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    const updated = await prisma.formSubmission.update({
      where: { id },
      data: { status },
    });

    res.json({
      message: "Status updated",
      id: updated.id,
      status: updated.status,
    });
  } catch (err) {
    console.error("Error updating submission status:", err);
    res.status(500).json({ message: "Error updating status" });
  }
};

export const assignSubmission = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { assignedToId } = req.body;

    const submission = await prisma.formSubmission.findUnique({
      where: { id },
    });

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    if (assignedToId !== null && assignedToId !== undefined) {
      const user = await prisma.user.findUnique({
        where: { id: assignedToId },
      });

      if (!user) {
        return res.status(400).json({ message: "Assigned user not found" });
      }
    }

    const updated = await prisma.formSubmission.update({
      where: { id },
      data: { assignedToId: assignedToId || null },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json({
      message: assignedToId ? "Submission assigned" : "Assignment removed",
      id: updated.id,
      assignedTo: updated.assignedTo,
    });
  } catch (err) {
    console.error("Error assigning submission:", err);
    res.status(500).json({ message: "Error assigning submission" });
  }
};
