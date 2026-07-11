/**
 * AURA receptionist — multi-turn session memory for voice calls and SMS threads.
 */
import { getDb } from "../db";

export type SessionChannel = "voice" | "sms";

export type SessionTurn = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type PendingBooking = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  service?: string;
  date?: string;
  time?: string;
  notes?: string;
};

export type ReceptionistSession = {
  sessionId: string;
  channel: SessionChannel;
  callerPhone: string | null;
  turns: SessionTurn[];
  pendingBooking: PendingBooking | null;
  greeted: boolean;
  updatedAt: number;
};

const SESSION_TTL_MS = 90 * 60_000; // Preserve context across disconnect / callback
const MAX_TURNS = 40;
const memory = new Map<string, ReceptionistSession>();

function pruneMemory(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const id of Array.from(memory.keys())) {
    const s = memory.get(id);
    if (s && s.updatedAt < cutoff) memory.delete(id);
  }
}

export async function ensureReceptionistSessionTable(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_receptionist_sessions (
      session_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      caller_phone TEXT,
      turns_json TEXT NOT NULL DEFAULT '[]',
      pending_booking_json TEXT,
      greeted INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

async function loadSessionFromDb(sessionId: string): Promise<ReceptionistSession | null> {
  try {
    await ensureReceptionistSessionTable();
    const db = await getDb();
    const row = await db.get<{
      session_id: string;
      channel: string;
      caller_phone: string | null;
      turns_json: string;
      pending_booking_json: string | null;
      greeted: number;
      updated_at: string;
    }>("SELECT * FROM aura_receptionist_sessions WHERE session_id = ?", sessionId);

    if (!row) return null;
    const updatedAt = new Date(row.updated_at).getTime();
    if (Date.now() - updatedAt > SESSION_TTL_MS) return null;

    return {
      sessionId: row.session_id,
      channel: row.channel as SessionChannel,
      callerPhone: row.caller_phone,
      turns: JSON.parse(row.turns_json || "[]") as SessionTurn[],
      pendingBooking: row.pending_booking_json ? JSON.parse(row.pending_booking_json) : null,
      greeted: Boolean(row.greeted),
      updatedAt,
    };
  } catch {
    return null;
  }
}

async function persistSession(session: ReceptionistSession): Promise<void> {
  try {
    await ensureReceptionistSessionTable();
    const db = await getDb();
    await db.run(
      `INSERT INTO aura_receptionist_sessions (session_id, channel, caller_phone, turns_json, pending_booking_json, greeted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         turns_json = excluded.turns_json,
         pending_booking_json = excluded.pending_booking_json,
         greeted = excluded.greeted,
         updated_at = excluded.updated_at`,
      session.sessionId,
      session.channel,
      session.callerPhone,
      JSON.stringify(session.turns.slice(-MAX_TURNS)),
      session.pendingBooking ? JSON.stringify(session.pendingBooking) : null,
      session.greeted ? 1 : 0,
      new Date(session.updatedAt).toISOString()
    );
  } catch (err) {
    console.warn("AURA session persist skipped:", err);
  }
}

export async function getReceptionistSession(
  sessionId: string,
  channel: SessionChannel,
  callerPhone?: string | null
): Promise<ReceptionistSession> {
  pruneMemory();
  const cached = memory.get(sessionId);
  if (cached && Date.now() - cached.updatedAt < SESSION_TTL_MS) return cached;

  const fromDb = await loadSessionFromDb(sessionId);
  if (fromDb) {
    memory.set(sessionId, fromDb);
    return fromDb;
  }

  const fresh: ReceptionistSession = {
    sessionId,
    channel,
    callerPhone: callerPhone ?? null,
    turns: [],
    pendingBooking: null,
    greeted: false,
    updatedAt: Date.now(),
  };
  memory.set(sessionId, fresh);
  return fresh;
}

export async function appendSessionTurn(
  session: ReceptionistSession,
  role: "user" | "assistant",
  content: string
): Promise<ReceptionistSession> {
  session.turns.push({ role, content, at: new Date().toISOString() });
  if (session.turns.length > MAX_TURNS) session.turns = session.turns.slice(-MAX_TURNS);
  session.updatedAt = Date.now();
  memory.set(session.sessionId, session);
  await persistSession(session);
  return session;
}

export async function updateSessionBooking(
  session: ReceptionistSession,
  booking: PendingBooking | null
): Promise<ReceptionistSession> {
  session.pendingBooking = booking;
  session.updatedAt = Date.now();
  memory.set(session.sessionId, session);
  await persistSession(session);
  return session;
}

export async function markSessionGreeted(session: ReceptionistSession): Promise<void> {
  session.greeted = true;
  session.updatedAt = Date.now();
  memory.set(session.sessionId, session);
  await persistSession(session);
}

export function sessionMessagesForLlm(session: ReceptionistSession): { role: "user" | "assistant"; content: string }[] {
  return session.turns.map((t) => ({ role: t.role, content: t.content }));
}
