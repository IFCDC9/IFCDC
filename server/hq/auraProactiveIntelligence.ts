/**
 * AURA Proactive Intelligence — emit meaningful, deduped Founder alerts only.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { createLeadershipAlert } from "./criticalAlerts";
import { buildTechnicalCommandBriefing } from "./auraTechnicalCommandEngine";
import { buildExecutiveHealthSummary } from "./auraExecutiveAssistant";
import { trackComplianceDeadlines } from "./auraExecutiveOps";
import { buildOrgWideGrantMatches } from "./grantIntelligenceEngine";
import { logHqAudit } from "./hqAuditLog";
import { sendFounderSecurityEmail, sendFounderSecuritySms } from "../lib/notifications";
import { getFounderEmail } from "./auraFounderTrustEngine";
import { getLoadedFounderCandidatePhones } from "./auraFounderTrustEngine";

const COOLDOWN_MS = 6 * 60 * 60_000; // 6 hours per dedupe key

let tablesReady = false;

export async function ensureProactiveIntelligenceTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_proactive_alert_dedupe (
      dedupe_key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      last_emitted_at TEXT NOT NULL,
      emit_count INTEGER NOT NULL DEFAULT 1
    );
  `);
  tablesReady = true;
}

async function shouldEmit(dedupeKey: string): Promise<boolean> {
  await ensureProactiveIntelligenceTables();
  const db = await getDb();
  const row = await db.get<{ last_emitted_at: string }>(
    `SELECT last_emitted_at FROM aura_proactive_alert_dedupe WHERE dedupe_key = ?`,
    dedupeKey
  );
  if (!row) return true;
  return Date.now() - new Date(row.last_emitted_at).getTime() >= COOLDOWN_MS;
}

async function markEmitted(dedupeKey: string, title: string): Promise<void> {
  await ensureProactiveIntelligenceTables();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO aura_proactive_alert_dedupe (dedupe_key, title, last_emitted_at, emit_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       title = excluded.title,
       last_emitted_at = excluded.last_emitted_at,
       emit_count = emit_count + 1`,
    dedupeKey,
    title,
    now
  );
}

export type ProactiveAlertCandidate = {
  dedupeKey: string;
  title: string;
  message: string;
  priority: "high" | "normal" | "low";
  sourceModule: string;
  path?: string;
  notifySms?: boolean;
};

export async function collectProactiveAlertCandidates(): Promise<ProactiveAlertCandidate[]> {
  const out: ProactiveAlertCandidate[] = [];
  const [tech, executive, compliance, grants] = await Promise.all([
    buildTechnicalCommandBriefing().catch(() => null),
    buildExecutiveHealthSummary().catch(() => null),
    trackComplianceDeadlines().catch(() => ({ overdue: 0, dueNext14Days: 0, deadlines: [] as unknown[] })),
    buildOrgWideGrantMatches({ sort: "deadline", limit: 20, actorEmail: getFounderEmail() }).catch(() => ({ matches: [] })),
  ]);

  if (tech) {
    for (const f of tech.critical.slice(0, 3)) {
      out.push({
        dedupeKey: `tech:${f.id}`,
        title: `Critical system issue: ${f.title}`,
        message: `${f.detail} Recommended: ${f.recommendedFix || "Open Technical Command."}`,
        priority: "high",
        sourceModule: "aura_technical",
        path: "/hq/aura",
        notifySms: true,
      });
    }
    if (tech.deployAligned === false) {
      out.push({
        dedupeKey: "deploy:misaligned",
        title: "Render behind GitHub main",
        message: `Live ${tech.liveCommit || "?"} vs GitHub ${tech.githubCommit || "?"}. Manual Deploy may be required after review.`,
        priority: "high",
        sourceModule: "render",
        path: "/hq/integrations",
        notifySms: true,
      });
    }
  }

  const overdue = (compliance as { overdue?: number }).overdue ?? 0;
  const dueSoon = (compliance as { dueNext14Days?: number }).dueNext14Days ?? 0;
  if (overdue > 0) {
    out.push({
      dedupeKey: `compliance:overdue:${overdue}`,
      title: `${overdue} compliance deadline(s) overdue`,
      message: "Review compliance deadlines in Executive / Grant Center immediately.",
      priority: "high",
      sourceModule: "compliance",
      path: "/hq/grants",
      notifySms: true,
    });
  } else if (dueSoon > 0) {
    out.push({
      dedupeKey: `compliance:due14:${dueSoon}`,
      title: `${dueSoon} compliance item(s) due within 14 days`,
      message: "Plan submissions before deadlines slip.",
      priority: "normal",
      sourceModule: "compliance",
      path: "/hq/grants",
    });
  }

  const pending = (executive as { pendingApprovals?: number } | null)?.pendingApprovals ?? 0;
  if (pending >= 3) {
    out.push({
      dedupeKey: `approvals:pending:${pending}`,
      title: `${pending} Founder approvals waiting`,
      message: "Unreviewed workflow approvals are stacking up in HQ.",
      priority: "normal",
      sourceModule: "workflows",
      path: "/hq/workflows",
    });
  }

  const matches = Array.isArray((grants as { matches?: unknown[] }).matches)
    ? (grants as { matches: Array<{ title?: string; deadline?: string; daysUntilDeadline?: number }> }).matches
    : [];
  const urgent = matches.filter((m) => typeof m.daysUntilDeadline === "number" && m.daysUntilDeadline >= 0 && m.daysUntilDeadline <= 7);
  if (urgent.length) {
    out.push({
      dedupeKey: `grants:deadline7:${urgent.length}`,
      title: `${urgent.length} grant opportunity deadline(s) within 7 days`,
      message: urgent.slice(0, 3).map((m) => m.title || "opportunity").join("; "),
      priority: "high",
      sourceModule: "grants",
      path: "/hq/grants",
      notifySms: true,
    });
  }

  return out;
}

export async function evaluateAndEmitProactiveAlerts(opts?: {
  notifyFounderChannels?: boolean;
}): Promise<{ evaluated: number; emitted: number; skipped: number; alerts: ProactiveAlertCandidate[] }> {
  const candidates = await collectProactiveAlertCandidates();
  let emitted = 0;
  let skipped = 0;
  const emittedAlerts: ProactiveAlertCandidate[] = [];

  for (const c of candidates) {
    if (!(await shouldEmit(c.dedupeKey))) {
      skipped += 1;
      continue;
    }
    await createLeadershipAlert({
      alertType: "aura_proactive",
      title: c.title,
      message: c.message,
      priority: c.priority,
      sourceModule: c.sourceModule,
      sourceId: c.dedupeKey,
      path: c.path,
    });
    await markEmitted(c.dedupeKey, c.title);
    emitted += 1;
    emittedAlerts.push(c);

    if (opts?.notifyFounderChannels && c.priority === "high" && c.notifySms) {
      const body = `IFCDC AURA Alert: ${c.title}. ${c.message}`.slice(0, 320);
      await sendFounderSecurityEmail({
        to: getFounderEmail(),
        subject: `AURA Alert: ${c.title}`,
        body: `${c.message}\n\nOpen HQ: ${c.path || "/hq/aura"}\n\n— AURA Proactive Intelligence`,
      }).catch(() => undefined);
      const phone = getLoadedFounderCandidatePhones()[0];
      if (phone) {
        await sendFounderSecuritySms({ to: phone, body }).catch(() => undefined);
      }
    }
  }

  await logHqAudit({
    action: "aura_proactive_scan",
    entityType: "aura_intelligence",
    detail: `evaluated=${candidates.length} emitted=${emitted} skipped=${skipped}`,
    metadata: { evaluated: candidates.length, emitted, skipped, ids: emittedAlerts.map((a) => a.dedupeKey) },
  }).catch(() => undefined);

  return { evaluated: candidates.length, emitted, skipped, alerts: emittedAlerts };
}

/** Idempotent scan id for scheduler logging. */
export function proactiveScanId(): string {
  return crypto.randomUUID();
}
