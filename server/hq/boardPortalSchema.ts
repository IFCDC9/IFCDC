import { getDb } from "../db";
import crypto from "crypto";

export function boardId() {
  return crypto.randomUUID();
}

export async function ensureBoardPortalTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS board_packets (
      id TEXT PRIMARY KEY,
      meeting_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      document_urls TEXT,
      financial_report_id TEXT,
      executive_summary TEXT,
      status TEXT DEFAULT 'draft',
      published_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS board_resolutions (
      id TEXT PRIMARY KEY,
      meeting_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      resolution_text TEXT,
      status TEXT DEFAULT 'proposed',
      vote_result TEXT,
      votes_for INTEGER DEFAULT 0,
      votes_against INTEGER DEFAULT 0,
      votes_abstain INTEGER DEFAULT 0,
      adopted_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS board_votes (
      id TEXT PRIMARY KEY,
      resolution_id TEXT NOT NULL,
      voter_email TEXT NOT NULL,
      voter_name TEXT,
      vote TEXT NOT NULL,
      voted_at TEXT NOT NULL,
      UNIQUE(resolution_id, voter_email)
    );
    CREATE INDEX IF NOT EXISTS idx_board_packets_meeting ON board_packets(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_board_resolutions_meeting ON board_resolutions(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_board_votes_resolution ON board_votes(resolution_id);
  `);

  try { await db.exec(`ALTER TABLE board_meetings ADD COLUMN packet_id TEXT`); } catch { /* exists */ }
  try { await db.exec(`ALTER TABLE board_meetings ADD COLUMN quorum_required INTEGER DEFAULT 5`); } catch { /* exists */ }
  try { await db.exec(`ALTER TABLE board_meetings ADD COLUMN minutes_status TEXT DEFAULT 'draft'`); } catch { /* exists */ }
}

export async function buildBoardPortalOverview() {
  await ensureBoardPortalTables();
  const db = await getDb();
  const [meetings, packets, resolutions, actions, boardDocs] = await Promise.all([
    db.all("SELECT * FROM board_meetings ORDER BY meeting_date DESC LIMIT 12"),
    db.all("SELECT * FROM board_packets ORDER BY created_at DESC LIMIT 10"),
    db.all("SELECT * FROM board_resolutions ORDER BY created_at DESC LIMIT 10"),
    db.all("SELECT * FROM board_action_items WHERE status = 'open' ORDER BY due_date ASC LIMIT 15"),
    db.all("SELECT * FROM hq_documents WHERE access_level = 'board' ORDER BY updated_at DESC LIMIT 20"),
  ]);
  const upcoming = (meetings as { meeting_date: string; status: string }[]).filter(
    (m) => new Date(m.meeting_date) >= new Date() && m.status !== "cancelled"
  );
  return {
    upcomingMeetings: upcoming.length,
    openActionsCount: actions.length,
    pendingResolutions: (resolutions as { status: string }[]).filter((r) => r.status === "proposed" || r.status === "voting").length,
    packets: packets.length,
    meetings,
    recentPackets: packets,
    resolutions,
    openActions: actions,
    secureDocuments: boardDocs,
  };
}

export async function castBoardVote(resolutionId: string, voter: { email: string; name?: string }, vote: "yes" | "no" | "abstain") {
  await ensureBoardPortalTables();
  const db = await getDb();
  const resolution = await db.get<{ id: string; status: string }>("SELECT id, status FROM board_resolutions WHERE id = ?", resolutionId);
  if (!resolution) return null;
  if (resolution.status !== "proposed" && resolution.status !== "voting") {
    throw new Error("Resolution is not open for voting");
  }

  const now = new Date().toISOString();
  await db.run(
    `INSERT OR REPLACE INTO board_votes (id, resolution_id, voter_email, voter_name, vote, voted_at) VALUES (?, ?, ?, ?, ?, ?)`,
    boardId(), resolutionId, voter.email, voter.name ?? "", vote, now
  );

  if (resolution.status === "proposed") {
    await db.run("UPDATE board_resolutions SET status = 'voting' WHERE id = ?", resolutionId);
  }

  const tallies = await db.get<{ yes: number; no: number; abstain: number }>(`
    SELECT
      SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) as yes,
      SUM(CASE WHEN vote = 'no' THEN 1 ELSE 0 END) as no,
      SUM(CASE WHEN vote = 'abstain' THEN 1 ELSE 0 END) as abstain
    FROM board_votes WHERE resolution_id = ?
  `, resolutionId);

  await db.run(
    `UPDATE board_resolutions SET votes_for = ?, votes_against = ?, votes_abstain = ? WHERE id = ?`,
    tallies?.yes ?? 0, tallies?.no ?? 0, tallies?.abstain ?? 0, resolutionId
  );

  return {
    resolution: await db.get("SELECT * FROM board_resolutions WHERE id = ?", resolutionId),
    votes: await db.all("SELECT voter_email, voter_name, vote, voted_at FROM board_votes WHERE resolution_id = ?", resolutionId),
  };
}

export async function finalizeResolution(resolutionId: string) {
  const db = await getDb();
  const r = await db.get<{ votes_for: number; votes_against: number }>("SELECT votes_for, votes_against FROM board_resolutions WHERE id = ?", resolutionId);
  if (!r) return null;
  const result = r.votes_for > r.votes_against ? "adopted" : "failed";
  const now = new Date().toISOString();
  await db.run(
    `UPDATE board_resolutions SET status = ?, vote_result = ?, adopted_at = ? WHERE id = ?`,
    result === "adopted" ? "adopted" : "rejected", result, now, resolutionId
  );
  return db.get("SELECT * FROM board_resolutions WHERE id = ?", resolutionId);
}
