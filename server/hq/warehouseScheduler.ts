import { runDueScheduledJobs } from "./workflowEngine";
import { scanPipelineDeadlineAlerts } from "./pipelineAutomation";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;
const PIPELINE_SCAN_INTERVAL_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let pipelineTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

async function runPipelineDeadlineScan(): Promise<void> {
  const result = await scanPipelineDeadlineAlerts(7);
  if (result.alertsSent > 0) {
    console.log(`[HQ Scheduler] Pipeline deadline scan: ${result.alertsSent} alert(s) queued`);
  }
}

export function startHqScheduler(): void {
  if (started) return;
  started = true;

  setTimeout(() => {
    runDueScheduledJobs("system-scheduler").catch((err) => {
      console.error("[HQ Scheduler] Initial run failed:", err);
    });
    runPipelineDeadlineScan().catch((err) => {
      console.error("[HQ Scheduler] Initial pipeline scan failed:", err);
    });
  }, STARTUP_DELAY_MS);

  timer = setInterval(() => {
    runDueScheduledJobs("system-scheduler").catch((err) => {
      console.error("[HQ Scheduler] Scheduled run failed:", err);
    });
  }, CHECK_INTERVAL_MS);

  pipelineTimer = setInterval(() => {
    runPipelineDeadlineScan().catch((err) => {
      console.error("[HQ Scheduler] Pipeline deadline scan failed:", err);
    });
  }, PIPELINE_SCAN_INTERVAL_MS);

  if (typeof timer.unref === "function") timer.unref();
  if (typeof pipelineTimer.unref === "function") pipelineTimer.unref();
}

export function stopHqScheduler(): void {
  if (timer) clearInterval(timer);
  if (pipelineTimer) clearInterval(pipelineTimer);
  timer = null;
  pipelineTimer = null;
  started = false;
}
