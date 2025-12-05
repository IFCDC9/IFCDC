import { Router, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const lowerEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: lowerEmail },
    });

    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const allowedRoles = ["client", "barber", "radio", "admin"];
    const finalRole = allowedRoles.includes(role) ? role : "client";

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email: lowerEmail,
        passwordHash,
        role: finalRole,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    return res.status(201).json({ message: "User created", role: user.role });
  } catch (err: any) {
    console.error("Register error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    const lowerEmail = (email || "").toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: lowerEmail },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("ifcdc_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      message: "Logged in",
      token,
      role: user.role,
      email: user.email,
      employeeId: user.employeeId ?? null,
    });
  } catch (err) {
    console.error("Login error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("ifcdc_token");
  return res.json({ message: "Logged out" });
});

router.get("/me", requireAuth(), async (req: AuthedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        employee: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      employee: user.employee
        ? {
            id: user.employee.id,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            role: user.employee.role,
            location: user.employee.location,
            status: user.employee.status,
          }
        : null,
    });
  } catch (err) {
    console.error("/api/auth/me error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
