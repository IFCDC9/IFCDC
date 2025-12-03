import { Request, Response } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../db/client";
import { config } from "../config/env";
import { insertUserSchema, loginSchema } from "@shared/schema";

export const register = async (req: Request, res: Response) => {
  try {
    const data = insertUserSchema.parse(req.body);
    
    const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }
    
    const passwordHash = await bcrypt.hash(data.passwordHash, 10);
    
    const user = await prisma.user.create({
      data: {
        ...data,
        passwordHash,
      },
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
    console.error(error);
    res.status(500).json({ message: "Failed to register user" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role },
      config.jwtSecret || "fallback-secret",
      { expiresIn: "8h" }
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    res.json({ 
      token, 
      user: { id: user.id, name: user.name, role: user.role } 
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: fromError(error).toString() });
    }
    console.error(error);
    res.status(500).json({ message: "Auth error" });
  }
};
