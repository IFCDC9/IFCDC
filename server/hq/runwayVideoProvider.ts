/**
 * Runway video provider (Phase 6C) — primary generative video path for IFCDC PRODUCTIONS.
 * Never prints, logs, or returns secret values / key prefixes.
 * CREDENTIAL presence is PRESENT | NOT_PRESENT only.
 */
import fs from "fs";

const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";

/** Prefer cheapest / shortest video models available on the account. */
export const RUNWAY_I2V_MODEL = "gen4_turbo"; // ~5 credits/sec
export const RUNWAY_T2V_MODEL = "gen4.5"; // text-to-video capable; ~12 credits/sec
export const RUNWAY_MIN_DURATION_SEC = 2;
export const RUNWAY_DEFAULT_RATIO = "1280:720";

const VIDEO_CAPS = new Set([
  "text_to_video",
  "image_to_video",
  "video_generation",
  "background_scene_broll",
  "reference_continuity",
]);

export function isRunwayVideoCapability(capability: string): boolean {
  return VIDEO_CAPS.has(capability);
}

function credentialRaw(): string {
  return String(process.env.RUNWAY_API_KEY || "").trim();
}

/** PRESENT | NOT_PRESENT — never returns the key. */
export function runwayApiKeyPresence(): "PRESENT" | "NOT_PRESENT" {
  const raw = credentialRaw();
  if (!raw) return "NOT_PRESENT";
  if (/placeholder|your[_-]?|xxx|replace/i.test(raw)) return "NOT_PRESENT";
  if (raw.length < 8) return "NOT_PRESENT";
  return "PRESENT";
}

function safeApiError(status: number, body: unknown): string {
  const msg =
    typeof body === "object" && body && "error" in body
      ? String((body as { error?: unknown }).error)
      : typeof body === "object" && body && "message" in body
        ? String((body as { message?: unknown }).message)
        : typeof body === "string"
          ? body.slice(0, 240)
          : `HTTP_${status}`;
  // Strip anything that looks like a bearer token / key fragment.
  return msg
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/key[_-]?[a-z0-9_-]{8,}/gi, "[redacted]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .slice(0, 300);
}

function extractCredits(task: Record<string, unknown>): unknown {
  for (const key of ["credits", "creditUsage", "creditsUsed", "cost", "usage"]) {
    if (task[key] != null) return task[key];
  }
  const nested = task.usage;
  if (nested && typeof nested === "object") return nested;
  return null;
}

async function runwayFetch(path: string, init: RequestInit = {}) {
  const key = credentialRaw();
  if (!key || runwayApiKeyPresence() !== "PRESENT") {
    return {
      ok: false as const,
      status: 0,
      body: null,
      error: "MISSING_CREDENTIAL:RUNWAY_API_KEY",
    };
  }
  const response = await fetch(`${RUNWAY_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "X-Runway-Version": RUNWAY_VERSION,
      ...(init.headers || {}),
    },
  });
  let body: unknown = null;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text ? { message: text.slice(0, 240) } : null;
  }
  return { ok: response.ok, status: response.status, body, error: null as string | null };
}

async function waitForTask(taskId: string, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const poll = await runwayFetch(`/tasks/${encodeURIComponent(taskId)}`);
    if (!poll.ok) {
      return {
        ok: false as const,
        status: "FAILED",
        blocker: `PROVIDER_ERROR:runway:poll_${poll.status}`,
        reason: safeApiError(poll.status, poll.body),
        task: null,
      };
    }
    const task = (poll.body || {}) as Record<string, unknown>;
    const state = String(task.status || task.state || "").toUpperCase();
    if (state === "SUCCEEDED" || state === "COMPLETED" || state === "SUCCESS") {
      return { ok: true as const, status: "SUCCEEDED", task, blocker: null, reason: null };
    }
    if (state === "FAILED" || state === "CANCELLED" || state === "CANCELED" || state === "ERROR") {
      const failure =
        typeof task.failure === "string"
          ? task.failure
          : typeof task.failureReason === "string"
            ? task.failureReason
            : safeApiError(poll.status, task);
      return {
        ok: false as const,
        status: "FAILED",
        blocker: `PROVIDER_ERROR:runway:${state}`,
        reason: String(failure).slice(0, 300),
        task,
      };
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return {
    ok: false as const,
    status: "FAILED",
    blocker: "PROVIDER_ERROR:runway:TIMEOUT",
    reason: "Runway task polling timed out",
    task: null,
  };
}

async function downloadOutput(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) return null;
    const ab = await response.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

function outputUrlFromTask(task: Record<string, unknown> | null): string | null {
  if (!task) return null;
  const output = task.output;
  if (typeof output === "string" && /^https?:\/\//i.test(output)) return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  if (output && typeof output === "object" && "url" in (output as object)) {
    const u = String((output as { url?: unknown }).url || "");
    if (/^https?:\/\//i.test(u)) return u;
  }
  for (const key of ["video", "videoUrl", "url", "outputUrl"]) {
    const v = task[key];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

function toDataUri(bytes: Buffer, mimeType = "image/png"): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

export type RunwayGenerateRequest = {
  prompt?: string;
  imageBytes?: Buffer | null;
  imageMimeType?: string;
  durationSeconds?: number;
  ratio?: string;
  /** reference_continuity only */
  referenceMode?: boolean;
};

export type RunwayGenerateResult = {
  ok: boolean;
  status: string;
  provider: "runway";
  providerModel: string | null;
  capability: string;
  bytes?: Buffer;
  mimeType?: string;
  durationSeconds?: number;
  ratio?: string;
  taskId?: string | null;
  creditsUsed?: unknown;
  creditsReported: boolean;
  fake: false;
  blocker?: string;
  reason?: string;
  notAvailableOnAccount?: boolean;
};

async function createAndDownload(
  capability: string,
  endpoint: "/text_to_video" | "/image_to_video",
  body: Record<string, unknown>,
  model: string,
  durationSeconds: number,
  ratio: string,
): Promise<RunwayGenerateResult> {
  const created = await runwayFetch(endpoint, { method: "POST", body: JSON.stringify(body) });
  if (!created.ok) {
    const reason = safeApiError(created.status, created.body);
    const notAvailable =
      created.status === 404 ||
      created.status === 402 ||
      /not\s*(available|supported|enabled)|unknown model|does not support|forbidden|payment|quota|plan/i.test(
        reason,
      );
    return {
      ok: false,
      status: notAvailable ? "NOT_AVAILABLE_ON_ACCOUNT" : "FAILED",
      provider: "runway",
      providerModel: model,
      capability,
      fake: false,
      blocker: notAvailable
        ? `NOT_AVAILABLE_ON_ACCOUNT:runway:${created.status}`
        : `PROVIDER_ERROR:runway:${created.status}`,
      reason,
      notAvailableOnAccount: notAvailable,
      creditsReported: false,
      durationSeconds,
      ratio,
    };
  }

  const createdBody = (created.body || {}) as Record<string, unknown>;
  const taskId = String(createdBody.id || createdBody.taskId || "").trim();
  if (!taskId) {
    return {
      ok: false,
      status: "FAILED",
      provider: "runway",
      providerModel: model,
      capability,
      fake: false,
      blocker: "PROVIDER_ERROR:runway:NO_TASK_ID",
      reason: "Runway create response missing task id",
      creditsReported: false,
      durationSeconds,
      ratio,
    };
  }

  const waited = await waitForTask(taskId);
  if (!waited.ok || !waited.task) {
    return {
      ok: false,
      status: waited.status,
      provider: "runway",
      providerModel: model,
      capability,
      fake: false,
      blocker: waited.blocker || "PROVIDER_ERROR:runway",
      reason: waited.reason || "Runway task failed",
      taskId,
      creditsUsed: waited.task ? extractCredits(waited.task) : null,
      creditsReported: Boolean(waited.task && extractCredits(waited.task) != null),
      durationSeconds,
      ratio,
    };
  }

  const creditsUsed = extractCredits(waited.task);
  const url = outputUrlFromTask(waited.task);
  if (!url) {
    return {
      ok: false,
      status: "FAILED",
      provider: "runway",
      providerModel: model,
      capability,
      fake: false,
      blocker: "PROVIDER_ERROR:runway:NO_OUTPUT_URL",
      reason: "Runway task succeeded without output URL",
      taskId,
      creditsUsed,
      creditsReported: creditsUsed != null,
      durationSeconds,
      ratio,
    };
  }

  const bytes = await downloadOutput(url);
  if (!bytes?.length) {
    return {
      ok: false,
      status: "FAILED",
      provider: "runway",
      providerModel: model,
      capability,
      fake: false,
      blocker: "PROVIDER_ERROR:runway:DOWNLOAD_FAILED",
      reason: "Could not download Runway output video",
      taskId,
      creditsUsed,
      creditsReported: creditsUsed != null,
      durationSeconds,
      ratio,
    };
  }

  return {
    ok: true,
    status: "GENERATED",
    provider: "runway",
    providerModel: model,
    capability,
    bytes,
    mimeType: "video/mp4",
    durationSeconds,
    ratio,
    taskId,
    creditsUsed,
    creditsReported: creditsUsed != null,
    fake: false,
  };
}

/**
 * Generate video via Runway. One attempt per call — caller may retry once on integration bugs.
 */
export async function generateRunwayVideo(
  capability: string,
  request: RunwayGenerateRequest = {},
): Promise<RunwayGenerateResult> {
  if (runwayApiKeyPresence() !== "PRESENT") {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      provider: "runway",
      providerModel: null,
      capability,
      fake: false,
      blocker: "MISSING_CREDENTIAL:RUNWAY_API_KEY",
      reason: "RUNWAY_API_KEY not present in production environment",
      creditsReported: false,
    };
  }

  const prompt = String(
    request.prompt ||
      "Non-person abstract IFCDC gold and ivory geometric motion graphic on deep black. Slow elegant camera drift. No people, no faces, no readable logos.",
  ).trim();
  const durationSeconds = Math.max(
    2,
    Math.min(10, Number(request.durationSeconds) || RUNWAY_MIN_DURATION_SEC),
  );
  const ratio = String(request.ratio || RUNWAY_DEFAULT_RATIO);

  if (capability === "reference_continuity" || request.referenceMode) {
    if (!request.imageBytes?.length) {
      return {
        ok: false,
        status: "ARCHITECTURE_READY",
        provider: "runway",
        providerModel: null,
        capability,
        fake: false,
        blocker: "MISSING_INPUT:reference_image",
        reason: "reference_continuity requires a source image",
        creditsReported: false,
      };
    }
    const dataUri = toDataUri(request.imageBytes, request.imageMimeType || "image/png");
    // Try dedicated reference/continuity shape first (not first-frame i2v).
    const refBody = {
      model: RUNWAY_T2V_MODEL,
      promptText: prompt,
      ratio,
      duration: durationSeconds,
      references: [{ uri: dataUri }],
    };
    const refAttempt = await createAndDownload(
      capability,
      "/image_to_video",
      refBody,
      RUNWAY_T2V_MODEL,
      durationSeconds,
      ratio,
    );
    if (refAttempt.ok) return refAttempt;

    // Second shape some accounts expose: referenceImages (gen4 reference naming).
    if (/references|referenceImages|not (supported|available|valid)|unknown field|unexpected/i.test(
      String(refAttempt.reason || ""),
    ) || refAttempt.notAvailableOnAccount) {
      const refImagesBody = {
        model: RUNWAY_T2V_MODEL,
        promptText: prompt,
        ratio,
        duration: durationSeconds,
        referenceImages: [{ uri: dataUri, tag: "plate" }],
      };
      const second = await createAndDownload(
        capability,
        "/image_to_video",
        refImagesBody,
        RUNWAY_T2V_MODEL,
        durationSeconds,
        ratio,
      );
      if (second.ok) return second;
      return {
        ...second,
        status: "NOT_AVAILABLE_ON_ACCOUNT",
        notAvailableOnAccount: true,
        blocker: `NOT_AVAILABLE_ON_ACCOUNT:runway:reference_continuity`,
        reason: second.reason || refAttempt.reason || "Reference/continuity endpoint not available on this account",
      };
    }
    return {
      ...refAttempt,
      status: "NOT_AVAILABLE_ON_ACCOUNT",
      notAvailableOnAccount: true,
      blocker: "NOT_AVAILABLE_ON_ACCOUNT:runway:reference_continuity",
    };
  }

  if (capability === "image_to_video") {
    if (!request.imageBytes?.length) {
      return {
        ok: false,
        status: "ARCHITECTURE_READY",
        provider: "runway",
        providerModel: RUNWAY_I2V_MODEL,
        capability,
        fake: false,
        blocker: "MISSING_INPUT:image_to_video",
        reason: "image_to_video requires source image bytes",
        creditsReported: false,
      };
    }
    const dataUri = toDataUri(request.imageBytes, request.imageMimeType || "image/png");
    return createAndDownload(
      capability,
      "/image_to_video",
      {
        model: RUNWAY_I2V_MODEL,
        promptImage: dataUri,
        promptText: prompt,
        ratio,
        duration: durationSeconds,
      },
      RUNWAY_I2V_MODEL,
      durationSeconds,
      ratio,
    );
  }

  // text_to_video / video_generation / broll — prefer dedicated text_to_video endpoint, then image_to_video without image.
  const t2vBody = {
    model: RUNWAY_T2V_MODEL,
    promptText: prompt,
    ratio,
    duration: durationSeconds,
  };
  const viaText = await createAndDownload(
    capability,
    "/text_to_video",
    t2vBody,
    RUNWAY_T2V_MODEL,
    durationSeconds,
    ratio,
  );
  if (viaText.ok) return viaText;

  // Fallback: gen4.5 text mode on image_to_video (omit promptImage) — still one logical attempt chain for T2V.
  if (
    viaText.status === "NOT_AVAILABLE_ON_ACCOUNT" ||
    /404|not found|unknown|not supported/i.test(String(viaText.reason || viaText.blocker || ""))
  ) {
    return createAndDownload(
      capability,
      "/image_to_video",
      t2vBody,
      RUNWAY_T2V_MODEL,
      durationSeconds,
      ratio,
    );
  }
  return viaText;
}

/** Read image bytes from disk without logging path contents beyond basename usage by caller. */
export function readImageBytesSafe(filePath: string): Buffer | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}
