/**
 * Local Headquarters route demonstration.
 * Signs a short-lived Founder test session, posts to the engineering task route,
 * and prints the task result without tokens.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = mkdtempSync(path.join(tmpdir(), "ifcdc-aura-se-demo-"));

process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = dataDir;
process.env.DATABASE_URL = "";
process.env.MASTER_OWNER_EMAIL = "service@ifcdc.org";
process.env.AURA_SE_APPROVED_REPO_ROOT = repoRoot;
process.env.AURA_SE_WORKTREE_PARENT = path.resolve(repoRoot, "..", ".aura-engineer-worktrees");
delete process.env.AURA_SE_RETAIN_WORKSPACE;
delete process.env.RENDER;
delete process.env.RENDER_SERVICE_ID;
delete process.env.AURA_SE_HOST_MODE;

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { default: softwareEngineeringRouter } = await import("../server/routes/softwareEngineering.routes.ts");
const { JWT_SECRET } = await import("../server/config/auth.ts");

const instruction = process.argv.slice(2).join(" ").trim()
  || "Record that AURA completed an isolated Headquarters engineering task for the Founder. This note is not a funding record or a production change.";

const app = express();
app.use(express.json());
app.use("/api/hq/aura/software-engineering", softwareEngineeringRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const port = (server.address() as AddressInfo).port;
const token = jwt.sign(
  { id: "founder-test", email: "service@ifcdc.org", role: "owner", name: "Founder session" },
  JWT_SECRET,
  { expiresIn: "10m" },
);

const response = await fetch(`http://127.0.0.1:${port}/api/hq/aura/software-engineering/tasks`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  // Synthetic test sessions must never publish to the real repository.
  body: JSON.stringify({ instruction, openPullRequest: false }),
});
const body = await response.json() as Record<string, unknown>;
const tests = body.tests as { command?: string; exitCode?: number | null; passed?: boolean; stdout?: string; stderr?: string } | null;
console.log(JSON.stringify({
  httpStatus: response.status,
  ok: body.ok,
  status: body.status,
  message: body.message,
  requester: body.requester,
  operator: body.operator,
  files: body.files,
  branch: body.branch,
  commitSha: body.commitSha,
  prUrl: body.prUrl,
  productionExecuted: body.productionExecuted,
  tests: tests
    ? { command: tests.command, exitCode: tests.exitCode, passed: tests.passed, stdout: tests.stdout, stderr: tests.stderr }
    : null,
}, null, 2));
await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
process.exit(response.ok ? 0 : 1);
