import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

router.post("/register", requireAuth(["admin"]), async (req, res) => {
  try {
    const { email, password, role, employeeId } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      return res.status(409).json({ error: "User with this email already exists" });
    }

    if (employeeId) {
      const employeeExists = await prisma.employee.findUnique({
        where: { id: employeeId },
      });
      if (!employeeExists) {
        return res.status(400).json({ error: "Invalid employeeId" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        employee: employeeId
          ? { connect: { id: employeeId } }
          : undefined,
      },
      select: {
        id: true,
        email: true,
        role: true,
        employeeId: true,
      },
    });

    return res.status(201).json(user);
  } catch (err: any) {
    console.error("Error registering user", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

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

    return res.json({
      token,
      role: user.role,
      email: user.email,
      employeeId: user.employeeId ?? null,
    });
  } catch (err) {
    console.error("Error during login", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
