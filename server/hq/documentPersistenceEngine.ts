/**
 * Document persistence — lock HQ files onto IFCDC_DATA_DIR (Render disk).
 *
 * Canonical bytes live at: {IFCDC_DATA_DIR}/uploads/hq
 * SQLite lives at:         {IFCDC_DATA_DIR}/ifcdc.db
 *
 * Does not invent documents, submit grants, or touch Twilio/SMS.
 */
import fs from "fs";
import path from "path";
import { getDataDir, getDbPath } from "../config/dataPaths";
import { getDb } from "../db";

export const CANONICAL_UPLOAD_SUBDIR = path.join("uploads", "hq");
export const EXPECTED_RENDER_MOUNT = "/opt/render/project/src/data";

function nowIso(): string {
  return new Date().toISOString();
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function deviceId(p: string): number | null {
  return safeStat(p)?.dev ?? null;
}

function listFiles(dir: string): Array<{ name: string; size: number; mtime: string }> {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => {
        const st = safeStat(path.join(dir, e.name));
        return {
          name: e.name,
          size: st?.size ?? 0,
          mtime: st ? new Date(st.mtimeMs).toISOString() : "",
        };
      });
  } catch {
    return [];
  }
}

export function canonicalUploadDir(): string {
  return path.join(getDataDir(), CANONICAL_UPLOAD_SUBDIR);
}

/** All historical write locations that must be migrated onto the disk. */
export function legacyUploadDirs(): string[] {
  const dataDir = getDataDir();
  const cwd = process.cwd();
  const dirs = [
    canonicalUploadDir(),
    path.join(dataDir, "hq-uploads"),
    path.join(cwd, "data", "uploads", "hq"),
    path.join(cwd, "data", "hq-uploads"),
    path.join(cwd, "server", "uploads", "hq"),
  ];
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

function parseStoredName(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const trimmed = String(fileUrl).trim();
  if (!trimmed) return null;
  const base = path.basename(trimmed.split("?")[0]);
  if (!base || base === "." || base === "..") return null;
  return base;
}

export function findPhysicalFile(storedName: string): string | null {
  const safe = path.basename(storedName);
  if (!safe || safe !== storedName) return null;
  for (const dir of legacyUploadDirs()) {
    const full = path.join(dir, safe);
    if (safeStat(full)?.isFile()) return full;
  }
  return null;
}

function readMounts(): string[] {
  try {
    const text = fs.readFileSync("/proc/mounts", "utf8");
    return text.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function dirWritable(dir: string): boolean {
  const probe = path.join(dir, ".ifcdc-persist-probe");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, nowIso(), "utf8");
    const ok = fs.readFileSync(probe, "utf8").length > 0;
    fs.unlinkSync(probe);
    return ok;
  } catch {
    return false;
  }
}

export async function probeDocumentPersistence(): Promise<Record<string, unknown>> {
  const dataDir = getDataDir();
  const dbPath = getDbPath();
  const canonical = canonicalUploadDir();
  fs.mkdirSync(canonical, { recursive: true });

  const parentDir = path.dirname(dataDir);
  const dataDev = deviceId(dataDir);
  const parentDev = deviceId(parentDir);
  const cwdDev = deviceId(process.cwd());
  const separateMount =
    dataDev != null && parentDev != null && dataDev !== parentDev;

  const mounts = readMounts();
  const mountHits = mounts.filter((line) => {
    const parts = line.split(/\s+/);
    const mountPoint = parts[1];
    return mountPoint === dataDir || mountPoint === EXPECTED_RENDER_MOUNT || dataDir.startsWith(`${mountPoint}/`);
  });

  const envDir = (process.env.IFCDC_DATA_DIR || "").trim();
  const dbStat = safeStat(dbPath);
  const dirStats = legacyUploadDirs().map((dir) => {
    const files = listFiles(dir);
    return {
      dir,
      exists: fs.existsSync(dir),
      fileCount: files.length,
      bytes: files.reduce((s, f) => s + f.size, 0),
      isCanonical: path.resolve(dir) === path.resolve(canonical),
    };
  });

  return {
    probedAt: nowIso(),
    render: Boolean(process.env.RENDER),
    envIfcdcDataDir: envDir || null,
    resolvedDataDir: dataDir,
    expectedRenderMount: EXPECTED_RENDER_MOUNT,
    envMatchesExpectedMount: envDir === EXPECTED_RENDER_MOUNT || dataDir === EXPECTED_RENDER_MOUNT,
    writable: dirWritable(dataDir) && dirWritable(canonical),
    separateFilesystemFromParent: separateMount,
    persistentStorageConfigured: Boolean(envDir) && envDir === EXPECTED_RENDER_MOUNT,
    persistentDiskDetected: separateMount || mountHits.length > 0,
    mountHits,
    devices: { dataDev, parentDev, cwdDev },
    db: {
      path: dbPath,
      exists: Boolean(dbStat),
      sizeBytes: dbStat?.size ?? 0,
      mtime: dbStat ? new Date(dbStat.mtimeMs).toISOString() : null,
    },
    uploadDirs: dirStats,
    canonicalUploadDir: canonical,
    physicalFileCount: listFiles(canonical).length,
  };
}

type HqDocRow = {
  id: string;
  title: string;
  category: string | null;
  evidence_type: string | null;
  file_url: string | null;
  file_name: string | null;
  mime_type: string | null;
  verification_status: string | null;
  source_module: string | null;
};

function classifyPresence(title: string, evidenceType: string | null): string[] {
  const blob = `${title} ${evidenceType || ""}`.toLowerCase();
  const tags: string[] = [];
  if (/501|determination|irs|letter\s*947/.test(blob)) tags.push("irs_501c3");
  if (/formation|incorporation|articles of/.test(blob)) tags.push("state_incorporation");
  if (/hiscox|professional\s*liability|p104\.904/.test(blob)) tags.push("hiscox_insurance");
  if (/bylaw/.test(blob)) tags.push("bylaws");
  if (/board/.test(blob)) tags.push("board_info");
  if (/budget/.test(blob)) tags.push("budget");
  if (/insurance|coi|liability/.test(blob)) tags.push("insurance");
  if (/policy|compliance|civil rights|procurement/.test(blob)) tags.push("compliance");
  return tags;
}

export async function inventoryHqDocuments(opts?: { repair?: boolean }): Promise<Record<string, unknown>> {
  const persistence = await probeDocumentPersistence();
  const repair = opts?.repair !== false;
  const repairLog: string[] = [];

  if (repair) {
    const canonical = canonicalUploadDir();
    fs.mkdirSync(canonical, { recursive: true });
    for (const dir of legacyUploadDirs()) {
      if (path.resolve(dir) === path.resolve(canonical)) continue;
      for (const file of listFiles(dir)) {
        const src = path.join(dir, file.name);
        const dest = path.join(canonical, file.name);
        if (fs.existsSync(dest)) continue;
        try {
          fs.copyFileSync(src, dest);
          repairLog.push(`migrated ${file.name} from ${dir}`);
        } catch (err) {
          repairLog.push(`failed migrating ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  const db = await getDb();
  let docs: HqDocRow[] = [];
  try {
    docs = ((await db.all(
      `SELECT id, title, category, evidence_type, file_url, file_name, mime_type, verification_status, source_module
       FROM hq_documents ORDER BY datetime(updated_at) DESC LIMIT 500`
    )) as HqDocRow[]) || [];
  } catch {
    docs = [];
  }

  let kbCount = 0;
  let grantDocCount = 0;
  let vaultCount = 0;
  let complianceCount = 0;
  try {
    kbCount = Number((await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM hq_knowledge_documents WHERE status = 'approved'`))?.c || 0);
  } catch { /* */ }
  try {
    grantDocCount = Number((await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM grant_documents`))?.c || 0);
  } catch { /* */ }
  try {
    vaultCount = Number((await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM grant_evidence_records`))?.c || 0);
  } catch { /* */ }
  try {
    complianceCount = Number((await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM compliance_filings`))?.c || 0);
  } catch { /* */ }

  const inventory = docs.map((d) => {
    const stored = parseStoredName(d.file_url);
    const physicalPath = stored ? findPhysicalFile(stored) : null;
    const bytesOnDisk = physicalPath ? safeStat(physicalPath)?.size ?? 0 : 0;
    return {
      id: d.id,
      title: d.title,
      category: d.category,
      evidenceType: d.evidence_type,
      fileName: d.file_name,
      fileUrl: d.file_url,
      storedName: stored,
      physicalPresent: Boolean(physicalPath),
      physicalPath: physicalPath ? path.relative(getDataDir(), physicalPath) : null,
      bytesOnDisk,
      verificationStatus: d.verification_status,
      sourceModule: d.source_module,
      tags: classifyPresence(d.title, d.evidence_type),
      auraRetrievable: Boolean(physicalPath) || Boolean(d.evidence_type),
      complianceRetrievable: Boolean(physicalPath) || Boolean(d.id),
      grantCenterRetrievable: Boolean(physicalPath) || Boolean(d.evidence_type),
    };
  });

  const missingBytes = inventory.filter((i) => i.fileUrl && !i.physicalPresent);
  const present = inventory.filter((i) => i.physicalPresent);
  const has = (tag: string) =>
    inventory.some((i) => i.tags.includes(tag) && (i.physicalPresent || i.verificationStatus === "verified"));

  const physicalCanonical = listFiles(canonicalUploadDir());
  const orphanFiles = physicalCanonical.filter(
    (f) => !inventory.some((i) => i.storedName === f.name)
  );

  return {
    persistence,
    repairLog,
    counts: {
      hqDocuments: docs.length,
      hqDocumentsWithPhysicalFile: present.length,
      hqDocumentsMissingBytes: missingBytes.length,
      physicalFilesInCanonicalDir: physicalCanonical.length,
      orphanFilesOnDisk: orphanFiles.length,
      knowledgeDocuments: kbCount,
      grantDocuments: grantDocCount,
      evidenceVaultRecords: vaultCount,
      complianceFilings: complianceCount,
    },
    namedPresence: {
      irs_501c3: has("irs_501c3"),
      state_incorporation: has("state_incorporation"),
      hiscox_insurance: has("hiscox_insurance"),
      bylaws: has("bylaws"),
      board_info: has("board_info"),
      budget: has("budget"),
      insurance: has("insurance"),
      compliance: has("compliance"),
    },
    documents: inventory,
    missingBytes: missingBytes.map((i) => ({ id: i.id, title: i.title, fileUrl: i.fileUrl })),
    orphanFiles: orphanFiles.map((f) => f.name),
    discrepancyNote:
      "Cursor workspace 'Files' counts (previously 24, now 20) are chat/canvas attachments, not HQ Document Center. Authoritative count is hq_documents + physical files on IFCDC_DATA_DIR.",
  };
}

export async function runDocumentPersistenceLockdown(opts?: {
  actorEmail?: string;
}): Promise<Record<string, unknown>> {
  const inventory = await inventoryHqDocuments({ repair: true });
  const persistence = inventory.persistence as Record<string, unknown>;

  // Re-index Document Center rows that have physical files into AURA knowledge.
  let reindexed = 0;
  try {
    const { indexUploadedDocument } = await import("./knowledgeBaseEngine");
    const docs = (inventory.documents as Array<{ id: string; physicalPresent: boolean }>) || [];
    for (const doc of docs.filter((d) => d.physicalPresent)) {
      const result = await indexUploadedDocument(doc.id, opts?.actorEmail);
      if (result && result.status !== "empty") reindexed++;
    }
  } catch {
    /* knowledge index best-effort */
  }

  const persistentDiskDetected = Boolean(persistence.persistentDiskDetected);
  const persistentStorageConfigured = Boolean(persistence.persistentStorageConfigured);
  const writable = Boolean(persistence.writable);

  return {
    ok: persistentStorageConfigured && writable,
    maySubmit: false,
    generatedAt: nowIso(),
    persistentStorageConfigured,
    ifcdcDataDirPersistent: persistentDiskDetected && writable,
    persistence,
    inventory,
    auraReindexedFromDisk: reindexed,
    sameSource:
      "hq_documents.file_url → IFCDC_DATA_DIR/uploads/hq → AURA knowledge (document:id) + Evidence Vault + Compliance filings",
  };
}
