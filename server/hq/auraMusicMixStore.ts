/**
 * AURA MUSIC Mix audio store for HQ playback (Original / Mix Vn).
 * Files uploaded by production node after Mix V2/V3 — never publishes externally.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { getDb } from "../db";

const MIX_DIR = join(process.cwd(), "data", "aura-music-mixes");

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
  mkdirSync(MIX_DIR, { recursive: true });
}

export async function storeAuraMusicMixAudio(opts: {
  jobId: string;
  revision: string;
  kind: string;
  filename: string;
  base64: string;
  reportText?: string;
}): Promise<{ id: string; path: string; bytes: number }> {
  await ensureAuraMusicMixTables();
  const db = await getDb();
  const buf = Buffer.from(opts.base64, "base64");
  const safeRev = opts.revision.replace(/[^\w.\-]+/g, "_");
  const safeKind = opts.kind.replace(/[^\w.\-]+/g, "_");
  const filename = `${opts.jobId}-${safeRev}-${safeKind}.wav`;
  const path = join(MIX_DIR, filename);
  writeFileSync(path, buf);
  const id = `mixaud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
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
  return { id, path, bytes: buf.length };
}

export async function getAuraMusicMixAudio(
  jobId: string,
  revision: string,
  kind: string
): Promise<{ path: string; filename: string; bytes: number; reportText: string | null } | null> {
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
  if (!row || !existsSync(row.path)) return null;
  return {
    path: row.path,
    filename: row.filename,
    bytes: row.bytes,
    reportText: row.report_text,
  };
}

export async function listAuraMusicMixAudio(jobId: string) {
  await ensureAuraMusicMixTables();
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, job_id, revision, kind, filename, bytes, created_at FROM aura_music_mix_audio
     WHERE job_id = ? ORDER BY created_at DESC`,
    jobId
  )) as Array<Record<string, unknown>>;
  return rows;
}

export async function getLatestMixReviewPayload(jobId?: string) {
  await ensureAuraMusicMixTables();
  const db = await getDb();
  // Prefer mix WAVs with engineering reports (not original uploads).
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
  return {
    jobId: row.job_id,
    revision: row.revision,
    report: row.report_text,
    createdAt: row.created_at,
    audio: items.map((i) => ({
      revision: i.revision,
      kind: i.kind,
      bytes: i.bytes,
      url: `/api/hq/aura/music/mixes/${i.job_id}/${encodeURIComponent(String(i.revision))}/${i.kind}`,
    })),
  };
}

export function readMixFile(path: string): Buffer {
  return readFileSync(path);
}
