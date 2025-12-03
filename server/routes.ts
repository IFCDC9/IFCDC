import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertUserSchema, insertChapterSchema, updateChapterSchema, loginSchema, insertAcknowledgementSchema } from "@shared/schema";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import bcrypt from "bcryptjs";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Authentication routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      
      // Check if user exists
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already exists" });
      }
      
      // Hash password
      const passwordHash = await bcrypt.hash(data.passwordHash, 10);
      
      // Create user
      const user = await storage.createUser({
        ...data,
        passwordHash,
      });
      
      res.status(201).json({ 
        id: user.id, 
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromError(error).toString() });
      }
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      
      const user = await storage.getUserByEmail(data.email);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Update last login
      await storage.updateUserLastLogin(user.id);
      
      res.json({ 
        id: user.id, 
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromError(error).toString() });
      }
      res.status(500).json({ message: "Failed to login" });
    }
  });

  // User routes
  app.get("/api/users", async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Chapter routes
  app.get("/api/chapters", async (req, res) => {
    try {
      const allChapters = await storage.getAllChapters();
      const ackStats = await storage.getAcknowledgementStats();
      
      // Add acknowledgement counts to chapters
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
  });

  app.get("/api/chapters/active", async (req, res) => {
    try {
      const activeChapters = await storage.getActiveChapters();
      res.json(activeChapters);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch active chapters" });
    }
  });

  app.get("/api/chapters/:id", async (req, res) => {
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
  });

  app.post("/api/chapters", async (req, res) => {
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
  });

  app.patch("/api/chapters/:id", async (req, res) => {
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
  });

  app.delete("/api/chapters/:id", async (req, res) => {
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
  });

  // Acknowledgement routes
  app.get("/api/acknowledgements", async (req, res) => {
    try {
      const stats = await storage.getAcknowledgementStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch acknowledgements" });
    }
  });

  app.get("/api/acknowledgements/user/:userId", async (req, res) => {
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

  app.get("/api/acknowledgements/chapter/:chapterId", async (req, res) => {
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

  app.post("/api/acknowledgements", async (req, res) => {
    try {
      const data = insertAcknowledgementSchema.parse(req.body);
      
      // Verify the chapter exists and get its version
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

  return httpServer;
}
