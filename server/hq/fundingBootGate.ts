/**
 * Deploy and process restart must not mutate funding.
 * The 6-hour and 4-hour timers, and POST /api/hq/grants/feeds/sync, stay outside this gate.
 */
export function shouldRunFundingBootSync(): boolean {
  return false;
}

/** Warehouse jobs whose body writes grant notifications or grant approval workflows. */
export function isFundingWarehouseJob(jobKey: string): boolean {
  return jobKey === "grant_deadlines" || jobKey === "compliance_reminders";
}

export function fundingWarehouseIntervalMs(jobKey: string): number {
  if (isFundingWarehouseJob(jobKey)) return 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

const fundingRestartReadyAt = new Map<string, number>();

/** An overdue funding job skipped at restart waits one full cadence before it may run. */
export function noteFundingRestartDeferral(jobKey: string, now: number): void {
  if (!isFundingWarehouseJob(jobKey)) return;
  fundingRestartReadyAt.set(jobKey, now + fundingWarehouseIntervalMs(jobKey));
}

export function fundingJobDeferredAfterRestart(jobKey: string, now: number): boolean {
  const readyAt = fundingRestartReadyAt.get(jobKey);
  if (readyAt == null) return false;
  if (now >= readyAt) {
    fundingRestartReadyAt.delete(jobKey);
    return false;
  }
  return true;
}

export function resetFundingRestartDeferral(): void {
  fundingRestartReadyAt.clear();
}

export function shouldRunScheduledJobNow(input: {
  jobKey: string;
  due: boolean;
  catchUp: boolean;
  now: number;
}): boolean {
  if (!input.due) return false;
  if (!isFundingWarehouseJob(input.jobKey)) return true;
  if (input.catchUp) return false;
  return !fundingJobDeferredAfterRestart(input.jobKey, input.now);
}

export function isFundingProactiveAlert(candidate: { dedupeKey: string; sourceModule: string }): boolean {
  if (candidate.sourceModule === "grants" || candidate.sourceModule === "compliance") return true;
  return candidate.dedupeKey.startsWith("grants:") || candidate.dedupeKey.startsWith("compliance:");
}

export function selectStartupSafeProactiveAlerts<T extends { dedupeKey: string; sourceModule: string }>(
  candidates: T[],
  includeFundingAlerts: boolean,
): T[] {
  if (includeFundingAlerts) return candidates;
  return candidates.filter((candidate) => !isFundingProactiveAlert(candidate));
}

export type FundingBootDeps = {
  syncGrantFeeds: () => Promise<unknown>;
  scheduleGrantIntelligenceSync: () => void;
  runGrantIntelligenceSync: () => Promise<unknown>;
  enrichAllOpportunities: (limit: number) => Promise<unknown>;
  scheduleLivePipelineSync: () => void;
  runLivePipelineSync: () => Promise<unknown>;
  setTimeoutFn?: typeof setTimeout;
  log?: (message: string) => void;
  warn?: (message: string) => void;
};

/** Start the approved timers. Immediate feed, score, and pipeline work runs only when the boot gate is on. */
export function startScheduledFundingJobs(deps: FundingBootDeps): { bootSyncStarted: boolean } {
  const log = deps.log ?? ((message: string) => console.log(message));
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const later = deps.setTimeoutFn ?? setTimeout;

  deps.scheduleGrantIntelligenceSync();
  deps.scheduleLivePipelineSync();

  if (!shouldRunFundingBootSync()) {
    return { bootSyncStarted: false };
  }

  void deps.syncGrantFeeds()
    .then((results) => {
      const rows = Array.isArray(results) ? results : [];
      const connected = rows.filter((row) => (row as { status?: string }).status === "connected").length;
      log(`Grant feed sync complete: ${connected}/${rows.length} feeds connected`);
    })
    .catch((error: unknown) => warn(`Grant feed sync skipped: ${error instanceof Error ? error.message : String(error)}`));

  void deps.runGrantIntelligenceSync()
    .then((result) => deps.enrichAllOpportunities(100).then((enriched) => ({ result, enriched })))
    .then((result) => {
      log(`Grant Intelligence Engine boot sync: enriched ${String(result.enriched)} opportunities`);
    })
    .catch((error: unknown) => warn(`Grant intelligence boot sync skipped: ${error instanceof Error ? error.message : String(error)}`));

  later(() => {
    void deps.runLivePipelineSync()
      .then((result) => {
        const row = result as { stagesSynced?: number; notifications?: number };
        log(`Enterprise Funding Pipeline boot sync: ${row.stagesSynced ?? 0} stages, ${row.notifications ?? 0} notifications`);
      })
      .catch((error: unknown) => warn(`Funding pipeline boot sync skipped: ${error instanceof Error ? error.message : String(error)}`));
  }, 120_000);

  return { bootSyncStarted: true };
}
