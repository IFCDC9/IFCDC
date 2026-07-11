/**
 * AURA Voice Reliability Engine — async jobs, stages, streaming partials,
 * multi-channel delivery, call monitoring, and reconnect context.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import type { ReceptionistTurnResult } from "./auraReceptionistEngine";

export type AuraVoiceJobStatus = "queued" | "running" | "done" | "error" | "deferred";

export type AuraVoiceJobStage =
  | "accepted"
  | "routing"
  | "gathering_hq_data"
  | "analyzing"
  | "drafting_reply"
  | "awaiting_founder_confirm"
  | "delivering"
  | "complete"
  | "failed";

export type DeliveryChannel = "sms" | "email" | "hq" | "workspace_report";

export type AuraVoiceJob = {
  id: string;
  sessionId: string;
  callSid: string | null;
  callerPhone: string | null;
  speech: string;
  commandType: string;
  status: AuraVoiceJobStatus;
  stage: AuraVoiceJobStage;
  stageLabel: string;
  progressPercent: number;
  result: ReceptionistTurnResult | null;
  /** Progressive speech already safe to say (streaming). */
  streamPartial: string | null;
  streamPartialSpoken: boolean;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  polls: number;
  deferredOfferSent: boolean;
  deliveryChannels: DeliveryChannel[];
  deliveredTo: DeliveryChannel[];
  founderConfirmRequired: boolean;
  founderConfirmed: boolean;
  latencyMs: number | null;
  providerErrors: string[];
  transcriptSnippet: string;
};

export type LiveCallMonitor = {
  callSid: string | null;
  sessionId: string;
  callerPhone: string | null;
  callerIdentity: string;
  founderMode: boolean;
  startedAt: string;
  durationSec: number;
  status: "ringing" | "in_progress" | "processing" | "completed" | "failed";
  currentTask: string | null;
  activeJobId: string | null;
  jobStatus: AuraVoiceJobStatus | null;
  jobStage: string | null;
  jobProgress: number | null;
  lastSpeech: string | null;
  lastReply: string | null;
  aiLatencyMs: number | null;
  providerErrors: string[];
  transcript: Array<{ role: string; content: string; at: string }>;
  updatedAt: string;
};

const jobs = new Map<string, AuraVoiceJob>();
const liveCalls = new Map<string, LiveCallMonitor>();
const JOB_TTL_MS = 45 * 60_000;
const CALL_TTL_MS = 45 * 60_000;
const MAX_POLL_BEFORE_DEFER = 24;

export const VOICE_ACK_BUDGET_MS = 4_500; // Faster first response / streaming feel
export const VOICE_STREAM_BUDGET_MS = 4_500;

let tablesReady = false;

export async function ensureAuraVoiceReliabilityTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_voice_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      call_sid TEXT,
      caller_phone TEXT,
      speech TEXT,
      command_type TEXT,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      stage_label TEXT,
      progress_percent REAL DEFAULT 0,
      result_json TEXT,
      stream_partial TEXT,
      error TEXT,
      delivery_channels_json TEXT,
      delivered_json TEXT,
      founder_confirm_required INTEGER DEFAULT 0,
      founder_confirmed INTEGER DEFAULT 0,
      latency_ms INTEGER,
      provider_errors_json TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_voice_jobs_phone ON aura_voice_jobs(caller_phone, started_at DESC);
    CREATE TABLE IF NOT EXISTS aura_voice_call_monitors (
      call_sid TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      caller_phone TEXT,
      caller_identity TEXT,
      founder_mode INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      current_task TEXT,
      active_job_id TEXT,
      transcript_json TEXT,
      provider_errors_json TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS aura_voice_workspace_reports (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      session_id TEXT,
      caller_phone TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  tablesReady = true;
}

function prune(): void {
  const now = Date.now();
  for (const [id, job] of Array.from(jobs.entries())) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
  for (const [id, call] of Array.from(liveCalls.entries())) {
    if (Date.now() - new Date(call.updatedAt).getTime() > CALL_TTL_MS) liveCalls.delete(id);
  }
}

function stageLabel(stage: AuraVoiceJobStage): string {
  switch (stage) {
    case "accepted":
      return "Request accepted";
    case "routing":
      return "Routing to the right Headquarters system";
    case "gathering_hq_data":
      return "Gathering live Headquarters data";
    case "analyzing":
      return "Analyzing across departments";
    case "drafting_reply":
      return "Drafting your executive reply";
    case "awaiting_founder_confirm":
      return "Waiting for your confirmation";
    case "delivering":
      return "Preparing delivery";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
    default:
      return stage;
  }
}

export function classifyVoiceCommand(speech: string): {
  commandType: string;
  founderConfirmRequired: boolean;
  highImpact: boolean;
} {
  const s = speech.toLowerCase();
  const highImpact =
    /\b(submit (the )?grant|send (the )?(email|sms|text)|approve payment|deploy|delete (production|record)|change security|terminate|hire and onboard)\b/i.test(
      s
    );
  let commandType = "general";
  if (/\bgrant search|find grants?|funding opportunit/i.test(s)) commandType = "grant_search";
  else if (/\bdraft (a )?grant|grant propos/i.test(s)) commandType = "grant_drafting";
  else if (/\bexecutive report|board (packet|report)|weekly (executive )?review\b/i.test(s)) commandType = "executive_report";
  else if (/\bsystem health|technical (command|brief)|production health\b/i.test(s)) commandType = "system_health";
  else if (/\bfunding pipeline|pipeline update\b/i.test(s)) commandType = "funding_pipeline";
  else if (/\bapproval (queue|review)|pending approvals?\b/i.test(s)) commandType = "founder_approvals";
  else if (/\b(send|draft).{0,20}(email|sms|communication)/i.test(s)) commandType = "communications";
  else if (/\b(create|start|open).{0,20}workflow\b/i.test(s)) commandType = "workflow_create";
  else if (/\bmission control|enterprise os\b/i.test(s)) commandType = "enterprise_os";
  return {
    commandType,
    founderConfirmRequired: highImpact,
    highImpact,
  };
}

export function createAuraVoiceJob(opts: {
  sessionId: string;
  callSid?: string | null;
  callerPhone?: string | null;
  speech: string;
}): AuraVoiceJob {
  prune();
  const classified = classifyVoiceCommand(opts.speech);
  const id = `vj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: AuraVoiceJob = {
    id,
    sessionId: opts.sessionId,
    callSid: opts.callSid || null,
    callerPhone: opts.callerPhone || null,
    speech: opts.speech,
    commandType: classified.commandType,
    status: "running",
    stage: "accepted",
    stageLabel: stageLabel("accepted"),
    progressPercent: 5,
    result: null,
    streamPartial: ackPhrase(opts.speech),
    streamPartialSpoken: false,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    polls: 0,
    deferredOfferSent: false,
    deliveryChannels: ["sms", "email", "hq", "workspace_report"],
    deliveredTo: [],
    founderConfirmRequired: classified.founderConfirmRequired,
    founderConfirmed: false,
    latencyMs: null,
    providerErrors: [],
    transcriptSnippet: opts.speech.slice(0, 400),
  };
  jobs.set(id, job);
  void persistJob(job);
  updateCallMonitorTask(opts.callSid || opts.sessionId, {
    currentTask: opts.speech.slice(0, 160),
    activeJobId: id,
    status: "processing",
    jobStatus: job.status,
    jobStage: job.stageLabel,
    jobProgress: job.progressPercent,
    lastSpeech: opts.speech,
  });
  // Advance stages optimistically while work runs
  setTimeout(() => updateAuraVoiceJobStage(id, "routing", 15), 400);
  setTimeout(() => updateAuraVoiceJobStage(id, "gathering_hq_data", 35), 1500);
  setTimeout(() => updateAuraVoiceJobStage(id, "analyzing", 55), 3500);
  setTimeout(() => updateAuraVoiceJobStage(id, "drafting_reply", 75), 6000);
  return job;
}

export function getAuraVoiceJob(id: string): AuraVoiceJob | null {
  prune();
  return jobs.get(id) || null;
}

export function updateAuraVoiceJobStage(id: string, stage: AuraVoiceJobStage, progressPercent: number, partial?: string): void {
  const job = jobs.get(id);
  if (!job || job.status === "done" || job.status === "error") return;
  job.stage = stage;
  job.stageLabel = stageLabel(stage);
  job.progressPercent = Math.min(99, progressPercent);
  if (partial) {
    job.streamPartial = partial;
    job.streamPartialSpoken = false;
  }
  void persistJob(job);
  updateCallMonitorTask(job.callSid || job.sessionId, {
    jobStage: job.stageLabel,
    jobProgress: job.progressPercent,
    jobStatus: job.status,
  });
}

export function markAuraVoiceJobDone(id: string, result: ReceptionistTurnResult): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "done";
  job.stage = job.founderConfirmRequired && !job.founderConfirmed ? "awaiting_founder_confirm" : "complete";
  job.stageLabel = stageLabel(job.stage);
  job.progressPercent = 100;
  job.result = result;
  job.streamPartial = result.reply;
  job.finishedAt = Date.now();
  job.latencyMs = job.finishedAt - job.startedAt;
  void persistJob(job);
  updateCallMonitorTask(job.callSid || job.sessionId, {
    status: "in_progress",
    jobStatus: job.status,
    jobStage: job.stageLabel,
    jobProgress: 100,
    lastReply: result.reply.slice(0, 400),
    aiLatencyMs: job.latencyMs,
    activeJobId: id,
  });
}

export function markAuraVoiceJobError(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "error";
  job.stage = "failed";
  job.stageLabel = stageLabel("failed");
  job.error = error;
  job.providerErrors.push(error);
  job.finishedAt = Date.now();
  job.latencyMs = job.finishedAt - job.startedAt;
  void persistJob(job);
  updateCallMonitorTask(job.callSid || job.sessionId, {
    status: "failed",
    jobStatus: "error",
    jobStage: job.stageLabel,
    providerErrors: job.providerErrors,
    aiLatencyMs: job.latencyMs,
  });
}

export function bumpAuraVoiceJobPoll(id: string): number {
  const job = jobs.get(id);
  if (!job) return 0;
  job.polls += 1;
  return job.polls;
}

export function shouldDeferAuraVoiceJob(job: AuraVoiceJob): boolean {
  return (job.status === "running" || job.status === "queued") && job.polls >= MAX_POLL_BEFORE_DEFER;
}

export function markDeferredOfferSent(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.deferredOfferSent = true;
  job.status = "deferred";
  void persistJob(job);
}

export function markStreamPartialSpoken(id: string): void {
  const job = jobs.get(id);
  if (job) job.streamPartialSpoken = true;
}

export function confirmFounderVoiceAction(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.founderConfirmed = true;
  if (job.status === "done") {
    job.stage = "complete";
    job.stageLabel = stageLabel("complete");
  }
  void persistJob(job);
}

async function persistJob(job: AuraVoiceJob): Promise<void> {
  try {
    await ensureAuraVoiceReliabilityTables();
    const db = await getDb();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO aura_voice_jobs (
        id, session_id, call_sid, caller_phone, speech, command_type, status, stage, stage_label,
        progress_percent, result_json, stream_partial, error, delivery_channels_json, delivered_json,
        founder_confirm_required, founder_confirmed, latency_ms, provider_errors_json, started_at, finished_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, stage=excluded.stage, stage_label=excluded.stage_label,
        progress_percent=excluded.progress_percent, result_json=excluded.result_json,
        stream_partial=excluded.stream_partial, error=excluded.error,
        delivered_json=excluded.delivered_json, founder_confirmed=excluded.founder_confirmed,
        latency_ms=excluded.latency_ms, provider_errors_json=excluded.provider_errors_json,
        finished_at=excluded.finished_at, updated_at=excluded.updated_at`,
      job.id,
      job.sessionId,
      job.callSid,
      job.callerPhone,
      job.speech,
      job.commandType,
      job.status,
      job.stage,
      job.stageLabel,
      job.progressPercent,
      job.result ? JSON.stringify({ reply: job.result.reply, action: job.result.action }) : null,
      job.streamPartial,
      job.error,
      JSON.stringify(job.deliveryChannels),
      JSON.stringify(job.deliveredTo),
      job.founderConfirmRequired ? 1 : 0,
      job.founderConfirmed ? 1 : 0,
      job.latencyMs,
      JSON.stringify(job.providerErrors),
      new Date(job.startedAt).toISOString(),
      job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
      now
    );
  } catch (err) {
    console.error("persist voice job failed:", err);
  }
}

/** Find incomplete work for a returning caller (reconnect / continue). */
export async function findResumableVoiceContext(callerPhone: string | null): Promise<{
  job: AuraVoiceJob | null;
  message: string | null;
}> {
  if (!callerPhone) return { job: null, message: null };
  prune();
  for (const job of Array.from(jobs.values())) {
    if (job.callerPhone === callerPhone && (job.status === "running" || job.status === "deferred" || (job.status === "done" && !job.streamPartialSpoken))) {
      return {
        job,
        message: `Welcome back. I still have your request about ${job.speech.slice(0, 80)}. ${
          job.status === "done"
            ? "The results are ready when you want them."
            : `It's currently ${job.stageLabel.toLowerCase()}, about ${Math.round(job.progressPercent)} percent complete.`
        } Say continue, send by text, send by email, or start over.`,
      };
    }
  }
  try {
    await ensureAuraVoiceReliabilityTables();
    const db = await getDb();
    const row = await db.get<Record<string, unknown>>(
      `SELECT * FROM aura_voice_jobs
       WHERE caller_phone = ? AND status IN ('running','deferred','done')
       ORDER BY started_at DESC LIMIT 1`,
      callerPhone
    );
    if (!row) return { job: null, message: null };
    const startedAt = new Date(String(row.started_at)).getTime();
    if (Date.now() - startedAt > JOB_TTL_MS) return { job: null, message: null };
    const speech = String(row.speech || "");
    return {
      job: null,
      message: `Welcome back. I found a recent Headquarters request: ${speech.slice(0, 90)}. Say continue if you want an update, or send by text or email for the completed report.`,
    };
  } catch {
    return { job: null, message: null };
  }
}

export async function deliverVoiceJobResult(
  jobId: string,
  channels: DeliveryChannel[]
): Promise<{ delivered: DeliveryChannel[]; message: string }> {
  const job = jobs.get(jobId);
  if (!job?.result) {
    return { delivered: [], message: "That report is not ready yet. I'll keep working and notify you when it is." };
  }
  const delivered: DeliveryChannel[] = [];
  const body = [
    "IFCDC AURA — Voice Task Report",
    `Job: ${job.id}`,
    `Request: ${job.speech}`,
    `Command: ${job.commandType}`,
    `Completed: ${new Date().toISOString()}`,
    "",
    job.result.reply,
    "",
    job.founderConfirmRequired && !job.founderConfirmed
      ? "NOTE: High-impact action still requires explicit Founder confirmation before execution."
      : "— AURA Voice Reliability",
  ].join("\n");

  if (channels.includes("hq")) {
    try {
      const { createLeadershipAlert } = await import("./criticalAlerts");
      await createLeadershipAlert({
        alertType: "aura_voice_report",
        title: `Voice report: ${job.commandType}`,
        message: body.slice(0, 500),
        priority: "normal",
        sourceModule: "aura_voice",
        sourceId: job.id,
        path: "/hq/communications",
      });
      delivered.push("hq");
    } catch (e) {
      job.providerErrors.push(`hq: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (channels.includes("email")) {
    try {
      const { sendFounderSecurityEmail } = await import("../lib/notifications");
      const { getFounderEmail } = await import("./auraFounderTrustEngine");
      await sendFounderSecurityEmail({
        to: getFounderEmail(),
        subject: `AURA Voice Report — ${job.commandType}`,
        body,
      });
      delivered.push("email");
    } catch (e) {
      job.providerErrors.push(`email: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (channels.includes("sms") && job.callerPhone) {
    try {
      const { sendFounderSecuritySms } = await import("../lib/notifications");
      await sendFounderSecuritySms({
        to: job.callerPhone,
        body: `AURA: ${job.result.reply.replace(/\s+/g, " ").slice(0, 320)}`,
      });
      delivered.push("sms");
    } catch (e) {
      job.providerErrors.push(`sms: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (channels.includes("workspace_report")) {
    try {
      await ensureAuraVoiceReliabilityTables();
      const db = await getDb();
      const rid = crypto.randomUUID();
      await db.run(
        `INSERT INTO aura_voice_workspace_reports (id, job_id, session_id, caller_phone, title, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        rid,
        job.id,
        job.sessionId,
        job.callerPhone,
        `Voice report: ${job.commandType}`,
        body,
        new Date().toISOString()
      );
      delivered.push("workspace_report");
    } catch (e) {
      job.providerErrors.push(`workspace: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  job.deliveredTo = Array.from(new Set([...job.deliveredTo, ...delivered]));
  void persistJob(job);
  await logHqAudit({
    action: "aura_voice_job_deliver",
    entityType: "aura_voice_job",
    entityId: job.id,
    detail: delivered.join(","),
    metadata: { channels, commandType: job.commandType },
  }).catch(() => undefined);

  return {
    delivered,
    message: delivered.length
      ? `I sent the completed report via ${delivered.join(", ")}. High-impact actions still need your explicit confirmation before execution.`
      : "I couldn't deliver yet. Please try email or text again in a moment.",
  };
}

export function upsertLiveCallMonitor(opts: {
  callSid?: string | null;
  sessionId: string;
  callerPhone?: string | null;
  callerIdentity?: string;
  founderMode?: boolean;
  status?: LiveCallMonitor["status"];
}): LiveCallMonitor {
  prune();
  const key = opts.callSid || opts.sessionId;
  const existing = liveCalls.get(key);
  const now = new Date().toISOString();
  const monitor: LiveCallMonitor = existing
    ? {
        ...existing,
        callerPhone: opts.callerPhone ?? existing.callerPhone,
        callerIdentity: opts.callerIdentity ?? existing.callerIdentity,
        founderMode: opts.founderMode ?? existing.founderMode,
        status: opts.status ?? existing.status,
        updatedAt: now,
        durationSec: Math.max(0, Math.round((Date.now() - new Date(existing.startedAt).getTime()) / 1000)),
      }
    : {
        callSid: opts.callSid || null,
        sessionId: opts.sessionId,
        callerPhone: opts.callerPhone || null,
        callerIdentity: opts.callerIdentity || "Caller",
        founderMode: Boolean(opts.founderMode),
        startedAt: now,
        durationSec: 0,
        status: opts.status || "in_progress",
        currentTask: null,
        activeJobId: null,
        jobStatus: null,
        jobStage: null,
        jobProgress: null,
        lastSpeech: null,
        lastReply: null,
        aiLatencyMs: null,
        providerErrors: [],
        transcript: [],
        updatedAt: now,
      };
  liveCalls.set(key, monitor);
  void persistCallMonitor(monitor);
  return monitor;
}

function updateCallMonitorTask(
  key: string,
  patch: Partial<LiveCallMonitor>
): void {
  let mon = liveCalls.get(key);
  if (!mon) {
    mon = upsertLiveCallMonitor({
      sessionId: key,
      callSid: key.startsWith("CA") ? key : null,
      status: "processing",
    });
  }
  Object.assign(mon, patch, {
    updatedAt: new Date().toISOString(),
    durationSec: Math.max(0, Math.round((Date.now() - new Date(mon.startedAt).getTime()) / 1000)),
  });
  void persistCallMonitor(mon);
}

export function appendCallTranscript(
  key: string,
  role: "user" | "assistant",
  content: string
): void {
  let mon = liveCalls.get(key);
  if (!mon) {
    mon = upsertLiveCallMonitor({ sessionId: key, callSid: key.startsWith("CA") ? key : null });
  }
  mon.transcript.push({ role, content: content.slice(0, 800), at: new Date().toISOString() });
  if (mon.transcript.length > 40) mon.transcript = mon.transcript.slice(-40);
  if (role === "user") mon.lastSpeech = content.slice(0, 400);
  if (role === "assistant") mon.lastReply = content.slice(0, 400);
  mon.updatedAt = new Date().toISOString();
  void persistCallMonitor(mon);
}

async function persistCallMonitor(mon: LiveCallMonitor): Promise<void> {
  try {
    await ensureAuraVoiceReliabilityTables();
    const db = await getDb();
    const sid = mon.callSid || mon.sessionId;
    await db.run(
      `INSERT INTO aura_voice_call_monitors (
        call_sid, session_id, caller_phone, caller_identity, founder_mode, status, current_task,
        active_job_id, transcript_json, provider_errors_json, started_at, updated_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(call_sid) DO UPDATE SET
        status=excluded.status, current_task=excluded.current_task, active_job_id=excluded.active_job_id,
        transcript_json=excluded.transcript_json, provider_errors_json=excluded.provider_errors_json,
        updated_at=excluded.updated_at, ended_at=excluded.ended_at, founder_mode=excluded.founder_mode`,
      sid,
      mon.sessionId,
      mon.callerPhone,
      mon.callerIdentity,
      mon.founderMode ? 1 : 0,
      mon.status,
      mon.currentTask,
      mon.activeJobId,
      JSON.stringify(mon.transcript),
      JSON.stringify(mon.providerErrors),
      mon.startedAt,
      mon.updatedAt,
      mon.status === "completed" || mon.status === "failed" ? mon.updatedAt : null
    );
  } catch (err) {
    console.error("persist call monitor failed:", err);
  }
}

export function listLiveCallMonitors(): LiveCallMonitor[] {
  prune();
  return Array.from(liveCalls.values())
    .map((m) => ({
      ...m,
      durationSec: Math.max(0, Math.round((Date.now() - new Date(m.startedAt).getTime()) / 1000)),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listRecentVoiceJobs(limit = 20): Promise<AuraVoiceJob[]> {
  prune();
  const mem = Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  if (mem.length) return mem;
  try {
    await ensureAuraVoiceReliabilityTables();
    const db = await getDb();
    const rows = (await db.all(
      `SELECT * FROM aura_voice_jobs ORDER BY started_at DESC LIMIT ?`,
      limit
    )) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      callSid: r.call_sid ? String(r.call_sid) : null,
      callerPhone: r.caller_phone ? String(r.caller_phone) : null,
      speech: String(r.speech || ""),
      commandType: String(r.command_type || "general"),
      status: r.status as AuraVoiceJobStatus,
      stage: r.stage as AuraVoiceJobStage,
      stageLabel: String(r.stage_label || r.stage),
      progressPercent: Number(r.progress_percent || 0),
      result: null,
      streamPartial: r.stream_partial ? String(r.stream_partial) : null,
      streamPartialSpoken: false,
      error: r.error ? String(r.error) : null,
      startedAt: new Date(String(r.started_at)).getTime(),
      finishedAt: r.finished_at ? new Date(String(r.finished_at)).getTime() : null,
      polls: 0,
      deferredOfferSent: false,
      deliveryChannels: [],
      deliveredTo: [],
      founderConfirmRequired: Boolean(r.founder_confirm_required),
      founderConfirmed: Boolean(r.founder_confirmed),
      latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
      providerErrors: [],
      transcriptSnippet: String(r.speech || "").slice(0, 200),
    }));
  } catch {
    return [];
  }
}

export async function raceVoiceTurn<T>(
  work: Promise<T>,
  budgetMs: number
): Promise<{ timedOut: false; value: T } | { timedOut: true; pending: Promise<T> }> {
  const pending = work;
  const winner = await Promise.race([
    pending.then((value) => ({ kind: "ok" as const, value })),
    new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), budgetMs)),
  ]);
  if (winner.kind === "ok") return { timedOut: false, value: winner.value };
  return { timedOut: true, pending };
}

export function progressPhrase(job: AuraVoiceJob): string {
  return `${job.stageLabel}. About ${Math.round(job.progressPercent)} percent complete. You can interrupt me anytime.`;
}

export function ackPhrase(speech: string): string {
  const classified = classifyVoiceCommand(speech);
  if (classified.highImpact) {
    return "Understood. That is a high-impact request. I will prepare it for your review and will not execute without your explicit confirmation.";
  }
  if (classified.commandType !== "general") {
    return `Understood. Starting ${classified.commandType.replace(/_/g, " ")}. I'll begin with what I have and keep you updated.`;
  }
  return "Got it. I'll start answering now and keep working on the full details.";
}

export function wantsDeliveryIntent(speech: string): DeliveryChannel[] | null {
  const s = speech.toLowerCase();
  if (!/\b(send|email|text|sms|notify|save report|hq notification)\b/i.test(s)) return null;
  const channels: DeliveryChannel[] = [];
  if (/\bemail\b/i.test(s)) channels.push("email");
  if (/\b(sms|text)\b/i.test(s)) channels.push("sms");
  if (/\bhq|notification\b/i.test(s)) channels.push("hq");
  if (/\bsave|workspace|report\b/i.test(s)) channels.push("workspace_report");
  if (!channels.length) channels.push("sms", "email", "hq", "workspace_report");
  return channels;
}

export function wantsContinueIntent(speech: string): boolean {
  return /\b(continue|resume|pick up|where we left|status of (my |the )?request)\b/i.test(speech);
}

export function wantsConfirmIntent(speech: string): boolean {
  return /\b(confirm|yes,? (approve|confirm|do it)|approved|go ahead and (submit|send|deploy))\b/i.test(speech);
}
