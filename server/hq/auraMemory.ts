/**
 * AURA memory — persistent conversation + action history per founder/user.
 *
 * Complements the live org context (buildAuraExecutiveContext) by giving AURA
 * continuity across turns: what was recently asked, what was prepared, and the
 * founder's stated priorities. Stored in SQLite; no external service.
 */

import { randomUUID } from "crypto";
import { getDb } from "../db";

export type AuraMemoryRole = "user" | "assistant";

export interface AuraMemoryTurn {
  id: string;
  actorEmail: string;
  module: string | null;
  role: AuraMemoryRole;
  content: string;
  actionJson: string | null;
  createdAt: string;
}

let tablesReady = false;

export async function ensureAuraMemoryTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_aura_conversations (
      id TEXT PRIMARY KEY,
      actor_email TEXT NOT NULL,
      module TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      action_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_conv_actor ON hq_aura_conversations(actor_email, created_at);
  `);
  tablesReady = true;
}

export async function recordAuraTurn(entry: {
  actorEmail: string;
  module?: string | null;
  role: AuraMemoryRole;
  content: string;
  action?: unknown;
}): Promise<void> {
  try {
    await ensureAuraMemoryTables();
    const db = await getDb();
    await db.run(
      `INSERT INTO hq_aura_conversations (id, actor_email, module, role, content, action_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      entry.actorEmail,
      entry.module ?? null,
      entry.role,
      entry.content.slice(0, 8000),
      entry.action ? JSON.stringify(entry.action).slice(0, 8000) : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.warn("[aura-memory] failed to record turn:", err instanceof Error ? err.message : err);
  }
}

/** Recent turns for a user, oldest-first, for LLM context. */
export async function getRecentAuraTurns(actorEmail: string, limit = 10): Promise<AuraMemoryTurn[]> {
  try {
    await ensureAuraMemoryTables();
    const db = await getDb();
    const rows = (await db.all(
      `SELECT id, actor_email, module, role, content, action_json, created_at
       FROM hq_aura_conversations WHERE actor_email = ?
       ORDER BY created_at DESC LIMIT ?`,
      actorEmail,
      limit
    )) as Array<{
      id: string;
      actor_email: string;
      module: string | null;
      role: string;
      content: string;
      action_json: string | null;
      created_at: string;
    }>;
    return rows
      .map((r) => ({
        id: r.id,
        actorEmail: r.actor_email,
        module: r.module,
        role: (r.role === "assistant" ? "assistant" : "user") as AuraMemoryRole,
        content: r.content,
        actionJson: r.action_json,
        createdAt: r.created_at,
      }))
      .reverse();
  } catch {
    return [];
  }
}

/** Compact memory summary injected into the AURA system context. */
export async function buildAuraMemoryContext(actorEmail: string): Promise<string> {
  const turns = await getRecentAuraTurns(actorEmail, 8);
  if (!turns.length) return "";
  const lines = turns.map((t) => {
    const who = t.role === "user" ? "Founder" : "AURA";
    return `- ${who}${t.module ? ` (${t.module})` : ""}: ${t.content.slice(0, 240)}`;
  });
  return `Recent AURA conversation with this user (for continuity):\n${lines.join("\n")}`;
}

export async function resetAuraMemory(actorEmail: string): Promise<{ cleared: number }> {
  try {
    await ensureAuraMemoryTables();
    const db = await getDb();
    const before = (await db.get(
      "SELECT COUNT(*) AS c FROM hq_aura_conversations WHERE actor_email = ?",
      actorEmail
    )) as { c?: number } | undefined;
    await db.run("DELETE FROM hq_aura_conversations WHERE actor_email = ?", actorEmail);
    return { cleared: before?.c ?? 0 };
  } catch {
    return { cleared: 0 };
  }
}
