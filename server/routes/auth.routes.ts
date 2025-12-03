import { Router } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import bcrypt from "bcryptjs";
import { storage } from "../storage";
import { insertUserSchema, loginSchema } from "@shared/schema";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const data = insertUserSchema.parse(req.body);
    
    const existingUser = await storage.getUserByEmail(data.email);
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }
    
    const passwordHash = await bcrypt.hash(data.passwordHash, 10);
    
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

router.post("/login", async (req, res) => {
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

export default router;
