import { Request, Response } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { storage } from "../storage";
import { insertChapterSchema, updateChapterSchema } from "@shared/schema";

export const getAll = async (req: Request, res: Response) => {
  try {
    const allChapters = await storage.getAllChapters();
    const ackStats = await storage.getAcknowledgementStats();
    
    const chaptersWithCounts = allChapters.map((chapter) => {
      const stat = ackStats.find(s => s.chapterId === chapter.id);
      return {
        ...chapter,
        acknowledgementCount: stat?.count || 0,
      };
    });
    
    res.json(chaptersWithCounts);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch chapters" });
  }
};

export const getActive = async (req: Request, res: Response) => {
  try {
    const activeChapters = await storage.getActiveChapters();
    res.json(activeChapters);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch active chapters" });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid chapter ID" });
    }
    
    const chapter = await storage.getChapter(id);
    if (!chapter) {
      return res.status(404).json({ message: "Chapter not found" });
    }
    
    const acks = await storage.getChapterAcknowledgements(id);
    res.json({
      ...chapter,
      acknowledgementCount: acks.length,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch chapter" });
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const data = insertChapterSchema.parse(req.body);
    const chapter = await storage.createChapter(data);
    res.status(201).json(chapter);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: fromError(error).toString() });
    }
    res.status(500).json({ message: "Failed to create chapter" });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid chapter ID" });
    }
    
    const data = updateChapterSchema.parse(req.body);
    const chapter = await storage.updateChapter(id, data);
    if (!chapter) {
      return res.status(404).json({ message: "Chapter not found" });
    }
    res.json(chapter);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: fromError(error).toString() });
    }
    res.status(500).json({ message: "Failed to update chapter" });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid chapter ID" });
    }
    
    const success = await storage.deleteChapter(id);
    if (!success) {
      return res.status(404).json({ message: "Chapter not found" });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: "Failed to delete chapter" });
  }
};
