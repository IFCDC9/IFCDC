/**
 * AURA MUSIC Master audio store for HQ Master workspace.
 * Premaster + Master A/B/C audition WAVs under IFCDC_DATA_DIR — never ephemeral /tmp.
 */
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  createReadStream,
  unlinkSync,
  renameSync,
} from "fs";
import { join, basename } from "path";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { getDataDir } from "../config/dataPaths";

export function getAuraMusicMasterDir(): string {
  const dir = join(getDataDir(), "aura-music-masters");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeMasterFilename(jobId: string, revision: string, kind: string): string {
  const safeRev = revision.replace(/[^\w.\-]+/g, "_");
  const safeKind = kind.replace(/[^\w.\-]+/g, "_");
  return `${jobId}-${safeRev}-${safeKind}.wav`;
}

export function resolveMasterAudioPath(storedPath: string, filename: string): string | null {
  if (storedPath && existsSync(storedPath)) {
    try {
      if (statSync(storedPath).size > 0) return storedPath;
    } catch {
      /* fall through */
    }
  }
  const candidates = [
    join(getAuraMusicMasterDir(), filename),
    join(getAuraMusicMasterDir(), basename(storedPath || filename)),
    join(process.cwd(), "data", "aura-music-masters", filename),
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

export async function ensureAuraMusicMasterTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_music_master_audio (
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
    CREATE INDEX IF NOT EXISTS idx_aura_master_job ON aura_music_master_audio(job_id, revision, kind);
  `);
  try {
    await db.exec(`ALTER TABLE aura_music_master_audio ADD COLUMN archived_at TEXT`);
  } catch {
    /* column already exists */
  }
  getAuraMusicMasterDir();
}

export async function storeAuraMusicMasterAudio(opts: {
  jobId: string;
  revision: string;
  kind: string;
  filename: string;
  base64: string;
  reportText?: string;
}): Promise<{ id: string; path: string; bytes: number; playbackUrl: string }> {
  await ensureAuraMusicMasterTables();
  const db = await getDb();
  const buf = Buffer.from(opts.base64, "base64");
  if (!buf.length) throw new Error("Master audio payload is empty (0 bytes)");
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Master audio payload is not a valid WAV (missing RIFF header)");
  }

  const filename = safeMasterFilename(opts.jobId, opts.revision, opts.kind);
  const masterDir = getAuraMusicMasterDir();
  const path = join(masterDir, filename);
  writeFileSync(path, buf);

  const id = `mstaud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const playbackUrl = `/api/hq/aura/music/masters/${encodeURIComponent(opts.jobId)}/${encodeURIComponent(opts.revision)}/${encodeURIComponent(opts.kind)}`;

  await db.run(
    `INSERT INTO aura_music_master_audio (id, job_id, revision, kind, filename, path, bytes, report_text, created_at)
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

  return { id, path, bytes: buf.length, playbackUrl };
}

export async function getAuraMusicMasterAudio(
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
  await ensureAuraMusicMasterTables();
  const db = await getDb();
  const row = (await db.get(
    `SELECT path, filename, bytes, report_text FROM aura_music_master_audio
     WHERE job_id = ? AND revision = ? AND kind = ?
     ORDER BY created_at DESC LIMIT 1`,
    jobId,
    revision,
    kind
  )) as { path: string; filename: string; bytes: number; report_text: string | null } | undefined;

  if (!row) return null;
  const resolved = resolveMasterAudioPath(row.path, row.filename);
  if (!resolved) return null;

  if (resolved !== row.path) {
    await db.run(
      `UPDATE aura_music_master_audio SET path = ?, bytes = ? WHERE job_id = ? AND revision = ? AND kind = ? AND path = ?`,
      resolved,
      statSync(resolved).size,
      jobId,
      revision,
      kind,
      row.path
    );
  }

  return {
    path: resolved,
    filename: row.filename,
    bytes: statSync(resolved).size,
    reportText: row.report_text,
    playbackUrl: `/api/hq/aura/music/masters/${encodeURIComponent(jobId)}/${encodeURIComponent(revision)}/${encodeURIComponent(kind)}`,
  };
}

export async function listAuraMusicMasterLibrary(opts?: { includeArchived?: boolean }) {
  await ensureAuraMusicMasterTables();
  const db = await getDb();
  const rows = (await db.all(
    opts?.includeArchived
      ? `SELECT id, job_id, revision, kind, filename, path, bytes, report_text, created_at, archived_at
         FROM aura_music_master_audio ORDER BY created_at DESC LIMIT 200`
      : `SELECT id, job_id, revision, kind, filename, path, bytes, report_text, created_at, archived_at
         FROM aura_music_master_audio WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 200`
  )) as Array<Record<string, unknown>>;

  return rows.map((i) => {
    const revision = String(i.revision);
    const kind = String(i.kind);
    const jobId = String(i.job_id);
    const filename = String(i.filename);
    const resolved = resolveMasterAudioPath(String(i.path || ""), filename);
    return {
      id: String(i.id),
      jobId,
      revision,
      kind,
      filename,
      bytes: resolved ? statSync(resolved).size : Number(i.bytes) || 0,
      playable: Boolean(resolved),
      mimeType: "audio/wav",
      report: (i.report_text as string) || null,
      createdAt: String(i.created_at || ""),
      archivedAt: i.archived_at ? String(i.archived_at) : null,
      url: `/api/hq/aura/music/masters/${encodeURIComponent(jobId)}/${encodeURIComponent(revision)}/${encodeURIComponent(kind)}`,
    };
  });
}

export async function archiveAuraMusicMasterAudio(id: string): Promise<{ ok: boolean; error?: string }> {
  await ensureAuraMusicMasterTables();
  const db = await getDb();
  const row = (await db.get(
    `SELECT id, path, filename, archived_at FROM aura_music_master_audio WHERE id = ?`,
    id
  )) as { id: string; path: string; filename: string; archived_at: string | null } | undefined;
  if (!row) return { ok: false, error: "Master asset not found" };
  if (row.archived_at) return { ok: true };

  const resolved = resolveMasterAudioPath(row.path, row.filename);
  const archiveDir = join(getAuraMusicMasterDir(), "archive");
  mkdirSync(archiveDir, { recursive: true });
  if (resolved && existsSync(resolved)) {
    const dest = join(archiveDir, basename(resolved));
    try {
      renameSync(resolved, dest);
      await db.run(
        `UPDATE aura_music_master_audio SET path = ?, archived_at = ? WHERE id = ?`,
        dest,
        new Date().toISOString(),
        id
      );
    } catch {
      await db.run(
        `UPDATE aura_music_master_audio SET archived_at = ? WHERE id = ?`,
        new Date().toISOString(),
        id
      );
    }
  } else {
    await db.run(
      `UPDATE aura_music_master_audio SET archived_at = ? WHERE id = ?`,
      new Date().toISOString(),
      id
    );
  }
  return { ok: true };
}

export async function deleteAuraMusicMasterAudio(id: string): Promise<{ ok: boolean; error?: string }> {
  await ensureAuraMusicMasterTables();
  const db = await getDb();
  const row = (await db.get(
    `SELECT id, path, filename FROM aura_music_master_audio WHERE id = ?`,
    id
  )) as { id: string; path: string; filename: string } | undefined;
  if (!row) return { ok: false, error: "Master asset not found" };

  const resolved = resolveMasterAudioPath(row.path, row.filename);
  if (resolved && existsSync(resolved)) {
    try {
      unlinkSync(resolved);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  await db.run(`DELETE FROM aura_music_master_audio WHERE id = ?`, id);
  return { ok: true };
}

export async function getLatestMasterReviewPayload(jobId?: string) {
  await ensureAuraMusicMasterTables();
  const db = await getDb();
  const row = (await db.get(
    jobId
      ? `SELECT job_id, revision, report_text, created_at FROM aura_music_master_audio
         WHERE job_id = ? AND archived_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      : `SELECT job_id, revision, report_text, created_at FROM aura_music_master_audio
         WHERE archived_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
    ...(jobId ? [jobId] : [])
  )) as { job_id: string; revision: string; report_text: string | null; created_at: string } | undefined;
  if (!row) return null;

  const items = (await db.all(
    `SELECT id, job_id, revision, kind, filename, path, bytes, report_text, created_at FROM aura_music_master_audio
     WHERE job_id = ? AND archived_at IS NULL ORDER BY created_at DESC`,
    row.job_id
  )) as Array<Record<string, unknown>>;

  const audio = items.map((i) => {
    const revision = String(i.revision);
    const kind = String(i.kind);
    const filename = String(i.filename);
    const resolved = resolveMasterAudioPath(String(i.path || ""), filename);
    return {
      id: String(i.id),
      revision,
      kind,
      bytes: resolved ? statSync(resolved).size : Number(i.bytes) || 0,
      playable: Boolean(resolved),
      mimeType: "audio/wav",
      report: (i.report_text as string) || null,
      url: `/api/hq/aura/music/masters/${encodeURIComponent(String(i.job_id))}/${encodeURIComponent(revision)}/${encodeURIComponent(kind)}`,
    };
  });

  const premaster = audio.find((a) => a.kind === "premaster" && a.playable) || null;
  const masterA = audio.find((a) => /MASTER-V1-A|Dynamic/i.test(a.revision) && a.kind === "master" && a.playable) || null;
  const masterB = audio.find((a) => /MASTER-V1-B|Competitive/i.test(a.revision) && a.kind === "master" && a.playable) || null;
  const masterC = audio.find((a) => /MASTER-V1-C|Platform/i.test(a.revision) && a.kind === "master" && a.playable) || null;

  return {
    jobId: row.job_id,
    revision: row.revision,
    report: row.report_text || audio.find((a) => a.report)?.report || null,
    createdAt: row.created_at,
    validationLabel: "VALIDATION MASTER — FINAL HUMAN VOCAL STILL REQUIRED",
    premasterUrl: premaster?.url || null,
    masterAUrl: masterA?.url || null,
    masterBUrl: masterB?.url || null,
    masterCUrl: masterC?.url || null,
    audio,
  };
}

export function streamMasterAudioFile(
  req: Request,
  res: Response,
  opts: {
    path: string;
    filename: string;
    bytes: number;
    jobId: string;
    revision: string;
    kind: string;
  }
): void {
  const { path: filePath, filename, bytes, jobId, revision, kind } = opts;
  const range = req.headers.range;
  const mime = "audio/wav";

  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);

  console.info("[aura-music-master] stream", {
    jobId,
    revision,
    kind,
    path: filePath,
    bytes,
    range: range || null,
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

export function readMasterFile(path: string): Buffer {
  return readFileSync(path);
}
