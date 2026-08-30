/**
 * AURA MUSIC Mix audio store for HQ playback (Original / Mix Vn).
 * Files live under IFCDC_DATA_DIR (Render persistent disk) — never ephemeral /tmp.
 */
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  createReadStream,
} from "fs";
import { join, basename } from "path";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { getDataDir } from "../config/dataPaths";

export function getAuraMusicMixDir(): string {
  const dir = join(getDataDir(), "aura-music-mixes");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeMixFilename(jobId: string, revision: string, kind: string): string {
  const safeRev = revision.replace(/[^\w.\-]+/g, "_");
  const safeKind = kind.replace(/[^\w.\-]+/g, "_");
  return `${jobId}-${safeRev}-${safeKind}.wav`;
}

/** Resolve on-disk path; migrate from legacy cwd/data paths if needed. */
export function resolveMixAudioPath(storedPath: string, filename: string): string | null {
  if (storedPath && existsSync(storedPath)) {
    try {
      if (statSync(storedPath).size > 0) return storedPath;
    } catch {
      /* fall through */
    }
  }
  const candidates = [
    join(getAuraMusicMixDir(), filename),
    join(getAuraMusicMixDir(), basename(storedPath || filename)),
    join(process.cwd(), "data", "aura-music-mixes", filename),
    join(process.cwd(), "data", "aura-music-mixes", basename(storedPath || filename)),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      try {
        if (statSync(p).size > 0) return p;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

export async function ensureAuraMusicMixTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_music_mix_audio (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      report_text TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_mix_job ON aura_music_mix_audio(job_id, revision, kind);
  `);
  getAuraMusicMixDir();
}

export async function storeAuraMusicMixAudio(opts: {
  jobId: string;
  revision: string;
  kind: string;
  filename: string;
  base64: string;
  reportText?: string;
}): Promise<{ id: string; path: string; bytes: number; playbackUrl: string }> {
  await ensureAuraMusicMixTables();
  const db = await getDb();
  const buf = Buffer.from(opts.base64, "base64");
  if (!buf.length) {
    throw new Error("Mix audio payload is empty (0 bytes)");
  }
  // Basic RIFF/WAVE header check — reject truncated uploads
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Mix audio payload is not a valid WAV (missing RIFF header)");
  }

  const filename = safeMixFilename(opts.jobId, opts.revision, opts.kind);
  const mixDir = getAuraMusicMixDir();
  const path = join(mixDir, filename);
  writeFileSync(path, buf);

  const id = `mixaud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const playbackUrl = `/api/hq/aura/music/mixes/${encodeURIComponent(opts.jobId)}/${encodeURIComponent(opts.revision)}/${encodeURIComponent(opts.kind)}`;

  await db.run(
    `INSERT INTO aura_music_mix_audio (id, job_id, revision, kind, filename, path, bytes, report_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    opts.jobId,
    opts.revision,
    opts.kind,
    filename,
    path,
    buf.length,
    opts.reportText || null,
    now
  );

  console.info("[aura-music-mix] stored", {
    id,
    jobId: opts.jobId,
    revision: opts.revision,
    kind: opts.kind,
    path,
    bytes: buf.length,
    playbackUrl,
    mime: "audio/wav",
  });

  return { id, path, bytes: buf.length, playbackUrl };
}

export async function getAuraMusicMixAudio(
  jobId: string,
  revision: string,
  kind: string
): Promise<{
  path: string;
  filename: string;
  bytes: number;
  reportText: string | null;
  playbackUrl: string;
} | null> {
  await ensureAuraMusicMixTables();
  const db = await getDb();
  const row = (await db.get(
    `SELECT path, filename, bytes, report_text FROM aura_music_mix_audio
     WHERE job_id = ? AND revision = ? AND kind = ?
     ORDER BY created_at DESC LIMIT 1`,
    jobId,
    revision,
    kind
  )) as { path: string; filename: string; bytes: number; report_text: string | null } | undefined;

  if (!row) {
    console.warn("[aura-music-mix] db miss", { jobId, revision, kind });
    return null;
  }

  const resolved = resolveMixAudioPath(row.path, row.filename);
  if (!resolved) {
    console.warn("[aura-music-mix] file missing on disk", {
      jobId,
      revision,
      kind,
      storedPath: row.path,
      filename: row.filename,
    });
    return null;
  }

  // Heal DB path if we resolved via fallback (persistent dir migration)
  if (resolved !== row.path) {
    await db.run(
      `UPDATE aura_music_mix_audio SET path = ?, bytes = ? WHERE job_id = ? AND revision = ? AND kind = ? AND path = ?`,
      resolved,
      statSync(resolved).size,
      jobId,
      revision,
      kind,
      row.path
    );
    console.info("[aura-music-mix] healed path", { from: row.path, to: resolved });
  }

  const size = statSync(resolved).size;
  return {
    path: resolved,
    filename: row.filename,
    bytes: size,
    reportText: row.report_text,
    playbackUrl: `/api/hq/aura/music/mixes/${encodeURIComponent(jobId)}/${encodeURIComponent(revision)}/${encodeURIComponent(kind)}`,
  };
}

export async function listAuraMusicMixAudio(jobId: string) {
  await ensureAuraMusicMixTables();
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, job_id, revision, kind, filename, path, bytes, report_text, created_at FROM aura_music_mix_audio
     WHERE job_id = ? ORDER BY created_at DESC`,
    jobId
  )) as Array<Record<string, unknown>>;
  return rows;
}

export async function getLatestMixReviewPayload(jobId?: string) {
  await ensureAuraMusicMixTables();
  const db = await getDb();
  const row = (await db.get(
    jobId
      ? `SELECT job_id, revision, report_text, created_at FROM aura_music_mix_audio
         WHERE job_id = ? AND kind = 'mix'
         ORDER BY created_at DESC LIMIT 1`
      : `SELECT job_id, revision, report_text, created_at FROM aura_music_mix_audio
         WHERE kind = 'mix'
         ORDER BY created_at DESC LIMIT 1`,
    ...(jobId ? [jobId] : [])
  )) as { job_id: string; revision: string; report_text: string | null; created_at: string } | undefined;
  if (!row) return null;

  const items = await listAuraMusicMixAudio(row.job_id);
  const audio = items.map((i) => {
    const revision = String(i.revision);
    const kind = String(i.kind);
    const filename = String(i.filename);
    const storedPath = String(i.path || "");
    const resolved = resolveMixAudioPath(storedPath, filename);
    const playable = Boolean(resolved);
    const bytes = resolved ? statSync(resolved).size : Number(i.bytes) || 0;
    return {
      revision,
      kind,
      bytes,
      playable,
      mimeType: "audio/wav",
      report: (i.report_text as string) || null,
      url: `/api/hq/aura/music/mixes/${encodeURIComponent(String(i.job_id))}/${encodeURIComponent(revision)}/${encodeURIComponent(kind)}`,
    };
  });

  // Prefer an original for A/B even when uploaded under a different revision label
  const original = audio.find((a) => a.kind === "original" && a.playable) || null;
  const mix =
    audio.find((a) => a.revision === row.revision && a.kind === "mix" && a.playable) ||
    audio.find((a) => a.kind === "mix" && a.playable) ||
    null;

  return {
    jobId: row.job_id,
    revision: row.revision,
    report: row.report_text,
    createdAt: row.created_at,
    originalUrl: original?.url || null,
    mixUrl: mix?.url || null,
    audio,
  };
}

export function readMixFile(path: string): Buffer {
  return readFileSync(path);
}

/**
 * Stream mix WAV with HTTP Range / 206 support (required for Safari / iPhone).
 */
export function streamMixAudioFile(req: Request, res: Response, opts: {
  path: string;
  filename: string;
  bytes: number;
  jobId: string;
  revision: string;
  kind: string;
}): void {
  const { path: filePath, filename, bytes, jobId, revision, kind } = opts;
  const range = req.headers.range;
  const mime = "audio/wav";

  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);

  console.info("[aura-music-mix] stream", {
    jobId,
    revision,
    kind,
    path: filePath,
    bytes,
    range: range || null,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 120),
  });

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.status(416).setHeader("Content-Range", `bytes */${bytes}`);
      res.end();
      return;
    }
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : bytes - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= bytes) {
      res.status(416).setHeader("Content-Range", `bytes */${bytes}`);
      res.end();
      return;
    }
    end = Math.min(end, bytes - 1);
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes}`);
    res.setHeader("Content-Length", String(chunkSize));
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.status(200);
  res.setHeader("Content-Length", String(bytes));
  createReadStream(filePath).pipe(res);
}
