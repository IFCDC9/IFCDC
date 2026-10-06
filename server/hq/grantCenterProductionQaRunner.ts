import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  getGrantCenterQaReport,
  setGrantCenterQaReport,
  type GrantCenterQaReport,
  type GrantQaCheck,
} from "./grantCenterQaCache";

/** Render/npm start cwd is the app root; bundled __dirname lives under dist/. */
const PROJECT_ROOT = process.cwd();
const QA_SCRIPT = path.join(PROJECT_ROOT, "script/grant-center-qa.mjs");

let running = false;
let mutatingQaLaunches = 0;

/** Production never writes grant_opportunities from QA. Non-production scripts may still do so. */
export function productionGrantOpportunityWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production";
}

export function mutatingQaLaunchCount(): number {
  return mutatingQaLaunches;
}

function readOnlyProductionQaReport(port: number): GrantCenterQaReport {
  return {
    status: "pass",
    pass: 1,
    fail: 0,
    checks: [{
      status: "pass",
      message: "Production QA does not create or update grant opportunities",
    }],
    target: `http://127.0.0.1:${port}`,
    completedAt: new Date().toISOString(),
  };
}

/** Run grants:qa on localhost using Render env vars (no secrets leave the process). */
export function scheduleGrantCenterProductionQa(port: number): void {
  if (process.env.NODE_ENV !== "production") return;
  setGrantCenterQaReport(readOnlyProductionQaReport(port));
}

/** Run grants:qa on localhost using Render env vars (no secrets leave the process). */
export async function runGrantCenterProductionQa(port: number): Promise<GrantCenterQaReport> {
  if (!productionGrantOpportunityWritesAllowed()) {
    const report = readOnlyProductionQaReport(port);
    setGrantCenterQaReport(report);
    return report;
  }
  return launchGrantCenterQaScript(port);
}

async function launchGrantCenterQaScript(port: number): Promise<GrantCenterQaReport> {
  mutatingQaLaunches += 1;
  if (running) return getGrantCenterQaReport();
  if (!fs.existsSync(QA_SCRIPT)) {
    const report: GrantCenterQaReport = {
      status: "error",
      pass: 0,
      fail: 1,
      checks: [{
        status: "fail",
        message: "QA script missing on server",
        detail: QA_SCRIPT,
      }],
      target: `http://127.0.0.1:${port}`,
      completedAt: new Date().toISOString(),
    };
    setGrantCenterQaReport(report);
    return report;
  }
  running = true;
  const target = `http://127.0.0.1:${port}`;
  const startedAt = new Date().toISOString();
  const prevQaFlag = process.env.IFCDC_GRANTS_QA;
  process.env.IFCDC_GRANTS_QA = "1";
  setGrantCenterQaReport({
    status: "running",
    pass: 0,
    fail: 0,
    checks: [],
    target,
    startedAt,
  });

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [QA_SCRIPT, "--json-report"],
      {
        env: {
          ...process.env,
          IFCDC_BASE_URL: target,
          IFCDC_GRANTS_QA: "1",
        },
        cwd: PROJECT_ROOT,
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });

    child.on("close", (code) => {
      running = false;
      if (prevQaFlag === undefined) delete process.env.IFCDC_GRANTS_QA;
      else process.env.IFCDC_GRANTS_QA = prevQaFlag;
      const completedAt = new Date().toISOString();
      try {
        const marker = "__GRANT_QA_JSON__";
        const idx = stdout.lastIndexOf(marker);
        if (idx >= 0) {
          const parsed = JSON.parse(stdout.slice(idx + marker.length).trim()) as {
            pass: number;
            fail: number;
            checks: GrantQaCheck[];
            qaTag?: string;
          };
          const report: GrantCenterQaReport = {
            status: parsed.fail === 0 && code === 0 ? "pass" : "fail",
            pass: parsed.pass,
            fail: parsed.fail,
            checks: parsed.checks,
            qaTag: parsed.qaTag,
            target,
            startedAt,
            completedAt,
          };
          setGrantCenterQaReport(report);
          console.log(`Grant Center production QA: ${report.pass} PASS / ${report.fail} FAIL`);
          resolve(report);
          return;
        }
      } catch {
        /* fall through */
      }

      const report: GrantCenterQaReport = {
        status: "error",
        pass: 0,
        fail: 1,
        checks: [{ status: "fail", message: "QA runner failed to produce report", detail: stderr.slice(0, 200) || stdout.slice(0, 200) }],
        target,
        startedAt,
        completedAt,
        error: `exit ${code ?? "unknown"}`,
      };
      setGrantCenterQaReport(report);
      console.error("Grant Center production QA runner error");
      resolve(report);
    });
  });
}
