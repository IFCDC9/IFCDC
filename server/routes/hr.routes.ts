import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth(["admin", "owner"]));

// Seed default staffing plan if empty
async function seedStaffingPlan() {
  const count = await prisma.staffingPlan.count();
  if (count === 0) {
    await prisma.staffingPlan.createMany({
      data: [
        { roleKey: "barber", roleName: "Barber", targetCount: 5, priority: 1 },
        { roleKey: "radio_host", roleName: "Radio Host", targetCount: 3, priority: 2 },
        { roleKey: "program_staff", roleName: "Program Staff", targetCount: 4, priority: 3 },
        { roleKey: "admin", roleName: "Admin", targetCount: 2, priority: 4 },
        { roleKey: "clinician", roleName: "Clinician", targetCount: 2, priority: 5 },
        { roleKey: "case_manager", roleName: "Case Manager", targetCount: 2, priority: 6 },
        { roleKey: "chw", roleName: "Community Health Worker", targetCount: 3, priority: 7 },
      ],
    });
  }
}
seedStaffingPlan().catch(console.error);

// Get staffing overview with current counts vs targets
router.get("/staffing-overview", async (_req, res) => {
  try {
    // Get all staffing plan entries
    const staffingPlan = await prisma.staffingPlan.findMany({
      orderBy: { priority: "asc" },
    });

    // Get employee counts by role and status
    const employees = await prisma.employee.groupBy({
      by: ["role", "status"],
      _count: { id: true },
    });

    // Build overview with counts
    const overview = staffingPlan.map((plan) => {
      const activeCount = employees
        .filter((e) => e.role === plan.roleKey && e.status === "active")
        .reduce((sum, e) => sum + e._count.id, 0);
      const onboardingCount = employees
        .filter((e) => e.role === plan.roleKey && e.status === "onboarding")
        .reduce((sum, e) => sum + e._count.id, 0);
      const openCount = Math.max(0, plan.targetCount - activeCount);

      return {
        id: plan.id,
        roleKey: plan.roleKey,
        roleName: plan.roleName,
        targetCount: plan.targetCount,
        activeCount,
        onboardingCount,
        openCount,
        priority: plan.priority,
        notes: plan.notes,
      };
    });

    const summary = {
      totalTarget: overview.reduce((sum, o) => sum + o.targetCount, 0),
      totalActive: overview.reduce((sum, o) => sum + o.activeCount, 0),
      totalOnboarding: overview.reduce((sum, o) => sum + o.onboardingCount, 0),
      totalOpen: overview.reduce((sum, o) => sum + o.openCount, 0),
    };

    return res.json({ overview, summary });
  } catch (err) {
    console.error("Error fetching staffing overview", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Update staffing plan target
router.patch("/staffing-plan/:id", async (req, res) => {
  try {
    const { targetCount, notes } = req.body;
    const updated = await prisma.staffingPlan.update({
      where: { id: req.params.id },
      data: {
        ...(targetCount !== undefined && { targetCount: Number(targetCount) }),
        ...(notes !== undefined && { notes }),
      },
    });
    return res.json(updated);
  } catch (err) {
    console.error("Error updating staffing plan", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

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
      payRate,
      payCurrency,
      payType,
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
        payRate: payRate ? Number(payRate) : null,
        payCurrency: payCurrency || "USD",
        payType: payType || "hourly",
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
        ...(body.payRate !== undefined && { payRate: body.payRate ? Number(body.payRate) : null }),
        ...(body.payCurrency !== undefined && { payCurrency: body.payCurrency }),
        ...(body.payType !== undefined && { payType: body.payType }),
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
