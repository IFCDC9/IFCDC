import { Router, Request, Response } from "express";
import { storage } from "../storage";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const forms = await storage.getAllForms();
    res.json(forms);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch forms" });
  }
});

router.get("/active", async (_req: Request, res: Response) => {
  try {
    const forms = await storage.getActiveForms();
    res.json(forms);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch active forms" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const form = await storage.getForm(id);
    if (!form) {
      return res.status(404).json({ error: "Form not found" });
    }
    res.json(form);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch form" });
  }
});

router.get("/slug/:slug", async (req: Request, res: Response) => {
  try {
    const form = await storage.getFormBySlug(req.params.slug);
    if (!form) {
      return res.status(404).json({ error: "Form not found" });
    }
    res.json(form);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch form" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { slug, title, schema, active } = req.body;
    if (!slug || !title || !schema) {
      return res.status(400).json({ error: "Missing required fields: slug, title, schema" });
    }
    const form = await storage.createForm({ slug, title, schema, active });
    res.status(201).json(form);
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Form with this slug already exists" });
    }
    res.status(500).json({ error: "Failed to create form" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { slug, title, schema, active } = req.body;
    const form = await storage.updateForm(id, { slug, title, schema, active });
    if (!form) {
      return res.status(404).json({ error: "Form not found" });
    }
    res.json(form);
  } catch (error) {
    res.status(500).json({ error: "Failed to update form" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteForm(id);
    if (!deleted) {
      return res.status(404).json({ error: "Form not found" });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete form" });
  }
});

router.get("/:id/submissions", async (req: Request, res: Response) => {
  try {
    const formId = parseInt(req.params.id);
    const submissions = await storage.getFormSubmissions(formId);
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

router.post("/:id/submissions", async (req: Request, res: Response) => {
  try {
    const formId = parseInt(req.params.id);
    const { userId, data } = req.body;
    if (!userId || !data) {
      return res.status(400).json({ error: "Missing required fields: userId, data" });
    }
    const submission = await storage.createFormSubmission({ formId, userId, data });
    res.status(201).json(submission);
  } catch (error) {
    res.status(500).json({ error: "Failed to create submission" });
  }
});

export default router;
