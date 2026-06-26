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
  `);
  const addCol = async (col: string, type: string) => {
    try { await db.exec(`ALTER TABLE hq_documents ADD COLUMN ${col} ${type}`); } catch { /* exists */ }
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
}
