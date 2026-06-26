import { getDb } from "../db";
import crypto from "crypto";

export function commId() {
  return crypto.randomUUID();
}

export async function ensureCommunicationsTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      author_email TEXT,
      author_name TEXT,
      published_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT DEFAULT 'published',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_messages (
      id TEXT PRIMARY KEY,
      from_email TEXT NOT NULL,
      from_name TEXT,
      to_email TEXT NOT NULL,
      to_name TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      channel TEXT DEFAULT 'direct',
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_announcements_published ON hq_announcements(published_at);
    CREATE INDEX IF NOT EXISTS idx_messages_to ON hq_messages(to_email);
    CREATE INDEX IF NOT EXISTS idx_messages_from ON hq_messages(from_email);
  `);

  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_announcements"))?.c ?? 0;
  if (count === 0) {
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO hq_announcements (id, title, body, priority, author_email, author_name, published_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      commId(),
      "Welcome to IFCDC Headquarters",
      "Headquarters is now the central operating system for all IFCDC divisions. Use People Management for HR, Grant Center for funding, and Financial Center for budgets and payroll.",
      "high",
      "service@ifcdc.org",
      "Founder",
      now,
      "published",
      now
    );
  }
}
