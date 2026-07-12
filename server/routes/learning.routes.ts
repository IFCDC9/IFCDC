import { Router } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";

const router = Router();
router.use(hqAuthRequired);

router.get("/dashboard", requireHQModule("policies"), async (_req, res) => {
  try {
    const { buildLearningDashboard } = await import("../hq/learningDevelopmentEngine");
    res.json(await buildLearningDashboard());
  } catch (error) {
    console.error("GET /learning/dashboard error:", error);
    res.status(500).json({ error: "Learning dashboard unavailable" });
  }
});

router.get("/courses", requireHQModule("policies"), async (_req, res) => {
  try {
    const { listLearningCourses } = await import("../hq/learningDevelopmentEngine");
    res.json({ courses: await listLearningCourses() });
  } catch (error) {
    console.error("GET /learning/courses error:", error);
    res.status(500).json({ error: "Courses unavailable" });
  }
});

router.post("/courses", requireHQModule("policies"), async (req, res) => {
  try {
    const { createLearningCourse } = await import("../hq/learningDevelopmentEngine");
    const title = String(req.body?.title ?? "").trim();
    if (!title) return res.status(400).json({ error: "title is required" });
    res.status(201).json({ course: await createLearningCourse(req.body) });
  } catch (error) {
    console.error("POST /learning/courses error:", error);
    res.status(500).json({ error: "Failed to create course" });
  }
});

router.post("/courses/:id/link-policy", requireHQModule("policies"), async (req, res) => {
  try {
    const policyId = String(req.body?.policy_id ?? "").trim();
    if (!policyId) return res.status(400).json({ error: "policy_id is required" });
    const { linkCourseToPolicy } = await import("../hq/learningDevelopmentEngine");
    res.json({ course: await linkCourseToPolicy(req.params.id, policyId) });
  } catch (error) {
    console.error("POST /learning/courses/:id/link-policy error:", error);
    res.status(500).json({ error: "Failed to link policy" });
  }
});

router.get("/paths", requireHQModule("policies"), async (_req, res) => {
  try {
    const { listLearningPaths } = await import("../hq/learningDevelopmentEngine");
    res.json({ paths: await listLearningPaths() });
  } catch (error) {
    console.error("GET /learning/paths error:", error);
    res.status(500).json({ error: "Learning paths unavailable" });
  }
});

router.get("/enrollments", requireHQModule("policies"), async (req, res) => {
  try {
    const { listEnrollments } = await import("../hq/learningDevelopmentEngine");
    res.json({
      enrollments: await listEnrollments({
        person_id: typeof req.query.person_id === "string" ? req.query.person_id : undefined,
        course_id: typeof req.query.course_id === "string" ? req.query.course_id : undefined,
      }),
    });
  } catch (error) {
    console.error("GET /learning/enrollments error:", error);
    res.status(500).json({ error: "Enrollments unavailable" });
  }
});

router.post("/enrollments", requireHQModule("policies"), async (req, res) => {
  try {
    const { assignCourse } = await import("../hq/learningDevelopmentEngine");
    const { course_id, person_name } = req.body ?? {};
    if (!course_id || !person_name) return res.status(400).json({ error: "course_id and person_name required" });
    res.status(201).json({
      enrollment: await assignCourse({
        ...req.body,
        assigned_by: req.hqUser?.email,
      }),
    });
  } catch (error) {
    console.error("POST /learning/enrollments error:", error);
    res.status(500).json({ error: "Failed to assign course" });
  }
});

router.post("/enrollments/:id/complete", requireHQModule("policies"), async (req, res) => {
  try {
    const { completeEnrollment } = await import("../hq/learningDevelopmentEngine");
    res.json(await completeEnrollment(req.params.id, req.body ?? {}));
  } catch (error) {
    console.error("POST /learning/enrollments/:id/complete error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Completion failed" });
  }
});

router.get("/certificates", requireHQModule("policies"), async (_req, res) => {
  try {
    const { listCertificates } = await import("../hq/learningDevelopmentEngine");
    res.json({ certificates: await listCertificates() });
  } catch (error) {
    console.error("GET /learning/certificates error:", error);
    res.status(500).json({ error: "Certificates unavailable" });
  }
});

router.get("/pd-costs", requireHQModule("policies"), async (_req, res) => {
  try {
    const { listProfessionalDevelopmentCosts } = await import("../hq/learningDevelopmentEngine");
    res.json({ costs: await listProfessionalDevelopmentCosts() });
  } catch (error) {
    console.error("GET /learning/pd-costs error:", error);
    res.status(500).json({ error: "PD costs unavailable" });
  }
});

router.post("/pd-costs", requireHQModule("policies"), async (req, res) => {
  try {
    const { logProfessionalDevelopmentCost } = await import("../hq/learningDevelopmentEngine");
    const { description, amount_cents, incurred_date } = req.body ?? {};
    if (!description || amount_cents == null || !incurred_date) {
      return res.status(400).json({ error: "description, amount_cents, and incurred_date required" });
    }
    res.status(201).json({ cost: await logProfessionalDevelopmentCost(req.body) });
  } catch (error) {
    console.error("POST /learning/pd-costs error:", error);
    res.status(500).json({ error: "Failed to log PD cost" });
  }
});

export default router;
