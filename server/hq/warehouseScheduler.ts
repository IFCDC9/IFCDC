import { runDueScheduledJobs } from "./workflowEngine";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function startHqScheduler(): void {
  if (started) return;
  started = true;

  setTimeout(() => {
    runDueScheduledJobs("system-scheduler").catch((err) => {
      console.error("[HQ Scheduler] Initial run failed:", err);
    });
  }, STARTUP_DELAY_MS);

  timer = setInterval(() => {
    runDueScheduledJobs("system-scheduler").catch((err) => {
      console.error("[HQ Scheduler] Scheduled run failed:", err);
    });
  }, CHECK_INTERVAL_MS);

  if (typeof timer.unref === "function") timer.unref();
}

export function stopHqScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
