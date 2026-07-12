import { getDb } from "../db";
import crypto from "crypto";
import { ensureOperationsTables } from "./operationsSchema";

export function docId() {
  return crypto.randomUUID();
}

export async function ensureDocumentTables(): Promise<void> {
  await ensureOperationsTables();
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      file_url TEXT,
      change_notes TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES hq_documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON hq_document_versions(document_id);

    CREATE TABLE IF NOT EXISTS hq_document_activity (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_email TEXT,
      actor_role TEXT,
      detail TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_doc_activity_doc ON hq_document_activity(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_activity_created ON hq_document_activity(created_at);

    CREATE TABLE IF NOT EXISTS hq_document_search_index (
      document_id TEXT PRIMARY KEY,
      search_blob TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const addCol = async (col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE hq_documents ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };
  await addCol("approval_status", "TEXT DEFAULT 'approved'");
  await addCol("submitted_by", "TEXT");
  await addCol("approved_by", "TEXT");
  await addCol("approved_at", "TEXT");
  await addCol("ocr_text", "TEXT");
  await addCol("signature_status", "TEXT DEFAULT 'unsigned'");
  await addCol("signed_by", "TEXT");
  await addCol("signed_at", "TEXT");
  await addCol("signature_data", "TEXT");
  await addCol("lifecycle_status", "TEXT DEFAULT 'active'");
  // Build 57 enterprise library fields
  await addCol("program_id", "TEXT");
  await addCol("project_id", "TEXT");
  await addCol("tags_json", "TEXT");
  await addCol("labels_json", "TEXT");
  await addCol("custom_metadata_json", "TEXT");
  await addCol("mime_type", "TEXT");
  await addCol("file_type", "TEXT");
  await addCol("owner_email", "TEXT");
  await addCol("visibility", "TEXT DEFAULT 'shared'");
  await addCol("source_module", "TEXT");
  await addCol("file_name", "TEXT");
  await addCol("file_size_bytes", "INTEGER");

  // Align legacy seed/category drift with Document Center folders.
  await db.run(`UPDATE hq_documents SET category = 'policies' WHERE category = 'policy'`).catch(() => undefined);
  await db.run(`UPDATE hq_documents SET access_level = 'confidential' WHERE access_level = 'hr'`).catch(() => undefined);
  await db.run(`UPDATE hq_documents SET visibility = 'shared' WHERE visibility IS NULL OR visibility = ''`).catch(() => undefined);
  await db.run(`UPDATE hq_documents SET owner_email = submitted_by WHERE owner_email IS NULL AND submitted_by IS NOT NULL`).catch(() => undefined);
}
