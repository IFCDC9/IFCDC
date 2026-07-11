/**
 * AURA Voice async job queue — keeps Twilio webhooks responsive during long HQ work.
 * Jobs run in-process; CallSid/session keyed. Results delivered on wait-loop or via SMS/email.
 */
import type { ReceptionistTurnResult } from "./auraReceptionistEngine";

export type AuraVoiceJobStatus = "running" | "done" | "error";

export type AuraVoiceJob = {
  id: string;
  sessionId: string;
  callSid: string | null;
  callerPhone: string | null;
  speech: string;
  status: AuraVoiceJobStatus;
  result: ReceptionistTurnResult | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  polls: number;
  deferredOfferSent: boolean;
};

const jobs = new Map<string, AuraVoiceJob>();
const JOB_TTL_MS = 30 * 60_000;
const MAX_POLL_BEFORE_DEFER = 24; // ~24 * (say+pause+redirect) ≈ 2–3 minutes of hold loops

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, job] of Array.from(jobs.entries())) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createAuraVoiceJob(opts: {
  sessionId: string;
  callSid?: string | null;
  callerPhone?: string | null;
  speech: string;
}): AuraVoiceJob {
  pruneJobs();
  const id = `vj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: AuraVoiceJob = {
    id,
    sessionId: opts.sessionId,
    callSid: opts.callSid || null,
    callerPhone: opts.callerPhone || null,
    speech: opts.speech,
    status: "running",
    result: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    polls: 0,
    deferredOfferSent: false,
  };
  jobs.set(id, job);
  return job;
}

export function getAuraVoiceJob(id: string): AuraVoiceJob | null {
  pruneJobs();
  return jobs.get(id) || null;
}

export function markAuraVoiceJobDone(id: string, result: ReceptionistTurnResult): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "done";
  job.result = result;
  job.finishedAt = Date.now();
}

export function markAuraVoiceJobError(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "error";
  job.error = error;
  job.finishedAt = Date.now();
}

export function bumpAuraVoiceJobPoll(id: string): number {
  const job = jobs.get(id);
  if (!job) return 0;
  job.polls += 1;
  return job.polls;
}

export function shouldDeferAuraVoiceJob(job: AuraVoiceJob): boolean {
  return job.status === "running" && job.polls >= MAX_POLL_BEFORE_DEFER;
}

export function markDeferredOfferSent(id: string): void {
  const job = jobs.get(id);
  if (job) job.deferredOfferSent = true;
}

/** Race a turn against the Twilio-safe budget. */
export async function raceVoiceTurn<T>(
  work: Promise<T>,
  budgetMs: number
): Promise<{ timedOut: false; value: T } | { timedOut: true; pending: Promise<T> }> {
  const pending = work;
  const winner = await Promise.race([
    pending.then((value) => ({ kind: "ok" as const, value })),
    new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), budgetMs)),
  ]);

  if (winner.kind === "ok") {
    return { timedOut: false, value: winner.value };
  }
  return { timedOut: true, pending };
}

export const VOICE_ACK_BUDGET_MS = 7_500;

export function progressPhrase(polls: number): string {
  const phrases = [
    "Still working on that for you. One moment.",
    "I'm pulling the latest Headquarters information. Stay with me.",
    "Almost there. Thank you for holding.",
    "Still gathering the details. I haven't forgotten you.",
    "Continuing the lookup now. I'll have an update shortly.",
  ];
  return phrases[polls % phrases.length];
}

export function ackPhrase(speech: string): string {
  const lower = speech.toLowerCase();
  if (/\b(grant|funding|board|brief|report|health|risk|budget|hire|strategy)\b/i.test(lower)) {
    return "Understood. Please hold while I gather that information from Headquarters.";
  }
  return "Got it. Give me a moment while I look that up.";
}
