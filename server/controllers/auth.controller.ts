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
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ 
      where: { email },
      include: { employee: true },
    });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    const name = user.employee 
      ? `${user.employee.firstName} ${user.employee.lastName}`
      : user.email;

    res.json({ 
      token, 
      user: { id: user.id, email: user.email, name, role: user.role } 
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: fromError(error).toString() });
    }
    console.error("Auth error", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
