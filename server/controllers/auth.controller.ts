import { Request, Response } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../db/client";
import { config } from "../config/env";

const JWT_SECRET = config.jwtSecret || "dev-secret";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.string(),
  employeeId: z.string().uuid().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, role, employeeId } = registerSchema.parse(req.body);
    
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        employeeId: employeeId ?? null,
      },
    });
    
    res.status(201).json({ ok: true, id: user.id });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: fromError(error).toString() });
    }
    console.error("Error registering user", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({ token, role: user.role, email: user.email });
  } catch (err) {
    console.error("Error during login", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
