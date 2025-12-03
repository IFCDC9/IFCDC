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

    const submission = await prisma.formSubmission.create({
      data: {
        formId: form.id,
        submittedById: user ? user.sub : null,
        data: payload,
      },
    });

    res.status(201).json({
      message: 'Form submitted successfully',
      submissionId: submission.id,
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
