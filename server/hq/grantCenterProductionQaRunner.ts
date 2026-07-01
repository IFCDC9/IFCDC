import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  getGrantCenterQaReport,
  grantCenterQaEnvReady,
  setGrantCenterQaReport,
  type GrantCenterQaReport,
  type GrantQaCheck,
} from "./grantCenterQaCache";

/** Render/npm start cwd is the app root; bundled __dirname lives under dist/. */
const PROJECT_ROOT = process.cwd();
const QA_SCRIPT = path.join(PROJECT_ROOT, "script/grant-center-qa.mjs");

let running = false;

/** Run grants:qa on localhost using Render env vars (no secrets leave the process). */
export function scheduleGrantCenterProductionQa(port: number): void {
  if (process.env.NODE_ENV !== "production") return;
  const env = grantCenterQaEnvReady();
  if (!env.ready) {
    setGrantCenterQaReport({
      status: "env_missing",
      pass: 0,
      fail: 1,
      checks: env.missing.map((key) => ({
        status: "fail",
        message: `Missing environment variable on ${env.service}`,
        detail: key,
      })),
      target: `http://127.0.0.1:${port}`,
      completedAt: new Date().toISOString(),
    });
    console.warn(`Grant Center QA skipped — set on Render service ifcdc-hq: ${env.missing.join(", ")}`);
    return;
  }

  setTimeout(() => {
    void runGrantCenterProductionQa(port);
  }, 8_000);
}

export async function runGrantCenterProductionQa(port: number): Promise<GrantCenterQaReport> {
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
