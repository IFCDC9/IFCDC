import { Router } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { storage } from "../storage";
import { insertAcknowledgementSchema } from "@shared/schema";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const stats = await storage.getAcknowledgementStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch acknowledgements" });
  }
});

router.get("/user/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    
    const acks = await storage.getUserAcknowledgements(userId);
    res.json(acks);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user acknowledgements" });
  }
});

router.get("/chapter/:chapterId", async (req, res) => {
  try {
    const chapterId = parseInt(req.params.chapterId);
    if (isNaN(chapterId)) {
      return res.status(400).json({ message: "Invalid chapter ID" });
    }
    
    const acks = await storage.getChapterAcknowledgements(chapterId);
    res.json(acks);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch chapter acknowledgements" });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = insertAcknowledgementSchema.parse(req.body);
    
    const chapter = await storage.getChapter(data.chapterId);
    if (!chapter) {
      return res.status(404).json({ message: "Chapter not found" });
    }
    
    const ack = await storage.createAcknowledgement({
      ...data,
      version: chapter.version,
    });
    res.status(201).json(ack);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: fromError(error).toString() });
    }
    res.status(500).json({ message: "Failed to create acknowledgement" });
  }
});

export default router;
