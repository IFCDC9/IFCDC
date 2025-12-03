import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth(["admin"]));

router.get("/employees", async (_req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.json(employees);
  } catch (err) {
    console.error("Error fetching employees", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employees/:id", async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }
    return res.json(employee);
  } catch (err) {
    console.error("Error fetching employee", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/employees", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      role,
      location,
      startDate,
      status,
      notes,
    } = req.body;

    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const employee = await prisma.employee.create({
      data: {
        firstName,
        lastName,
        email,
        phone: phone || null,
        role,
        location: location || null,
        startDate: startDate ? new Date(startDate) : null,
        status: status || "onboarding",
        notes: notes || null,
      },
    });

    return res.status(201).json(employee);
  } catch (err: any) {
    console.error("Error creating employee", err);
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Email already exists for another employee" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/employees/:id", async (req, res) => {
  const body = req.body;

  try {
    const updated = await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        ...(body.firstName && { firstName: body.firstName }),
        ...(body.lastName && { lastName: body.lastName }),
        ...(body.email && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.role && { role: body.role }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.startDate !== undefined && { startDate: body.startDate ? new Date(body.startDate) : null }),
        ...(body.status && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("Error updating employee", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/employees/:id", async (req, res) => {
  try {
    await prisma.employee.delete({
      where: { id: req.params.id },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error deleting employee", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
