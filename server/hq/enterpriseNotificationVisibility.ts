/**
 * Read-only Enterprise Notifications model for the Founder card and AURA.
 * buildAuraExecutiveContext can call answerEnterpriseNotificationQuestions later.
 * This module does not send, retry, acknowledge, or cancel.
 */
import { getDb } from "../db";
import { barbersOriginFromHealthUrl } from "./barbersOperationsSnapshot";
import { excludeQuarantinedLinkedOpportunitySql, isQuarantinedQaOpportunity } from "./grantQaFixtureQuarantine";

export const NOTIFICATION_ACTIVITY_FETCH_TIMEOUT_MS = 35000;

const READ_TOKEN_ENV = "HQ_BARBERS_SNAPSHOT_READ_TOKEN";
const READ_HEADER = "x-ifcdc-hq-read-token";

export const NOTIFICATION_GROUPS = [
  "confirmations",
  "reschedules",
  "cancellations",
  "reminders",
  "barber",
  "shop_admin",
  "account_security",
  "founder",
  "grant",
  "system_health",
  "in_app",
  "other",
] as const;

export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export interface StoredNotificationRecord {
  channel?: string | null;
  notificationType?: string | null;
  recipient?: string | null;
  bookingId?: string | null;
  relationship?: string | null;
  relationshipId?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  status?: string | null;
  storedStatus?: string | null;
  retryCount?: number | null;
  fallbackUsed?: boolean | null;
  errorReason?: string | null;
  template?: string | null;
  reminderWindow?: string | null;
  originatingApp?: string | null;
  eventId?: string | null;
  group?: NotificationGroup | null;
}

export interface EnterpriseNotificationRecord {
  time: string | null;
  type: string | null;
  recipient: string | null;
  originatingApp: string;
  bookingId: string | null;
  eventId: string | null;
  provider: string | null;
  providerMessageId: string | null;
  status: string | null;
  storedStatus: string | null;
  fallbackUsed: boolean | null;
  error: string | null;
  retryCount: number | null;
  template: string | null;
  reminderWindow: string | null;
  relationship: string | null;
  relationshipId: string | null;
  channel: string | null;
  group: NotificationGroup;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NotificationActivityPayload {
  ok?: boolean;
  readOnly?: boolean;
  email?: { available?: boolean; records?: StoredNotificationRecord[] };
  sms?: { available?: boolean; records?: StoredNotificationRecord[] };
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function nullableText(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

function nullableCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function notificationGroup(record: StoredNotificationRecord): NotificationGroup {
  if (record.group && NOTIFICATION_GROUPS.includes(record.group)) return record.group;
  const blob = [
    record.notificationType,
    record.template,
    record.relationship,
  ].filter(Boolean).join(" ").toLowerCase();
  if (blob.includes("reminder")) return "reminders";
  if (blob.includes("reschedul")) return "reschedules";
  if (blob.includes("cancel")) return "cancellations";
  if (blob.includes("barber")) return "barber";
  if (blob.includes("grant") || blob.includes("funding")) return "grant";
  if (blob.includes("health") || blob.includes("monitor")) return "system_health";
  if (blob.includes("founder") || blob.includes("daily_report") || blob.includes("daily report")) return "founder";
  if (blob.includes("password") || blob.includes("security") || blob.includes("verif")) return "account_security";
  if (blob.includes("admin") || blob.includes("shop")) return "shop_admin";
  if (blob.includes("confirm") || blob.includes("booking_approved") || blob.includes("booking_created")) return "confirmations";
  return "other";
}

export function mapStoredNotification(record: StoredNotificationRecord): EnterpriseNotificationRecord {
  const createdAt = nullableText(record.createdAt);
  const updatedAt = nullableText(record.updatedAt);
  return {
    time: updatedAt || createdAt,
    type: nullableText(record.notificationType) || nullableText(record.template),
    recipient: nullableText(record.recipient),
    originatingApp: nullableText(record.originatingApp) || "barbers",
    bookingId: nullableText(record.bookingId),
    eventId: nullableText(record.eventId) || nullableText(record.bookingId),
    provider: nullableText(record.provider),
    providerMessageId: nullableText(record.providerMessageId),
    status: nullableText(record.status),
    storedStatus: nullableText(record.storedStatus),
    fallbackUsed: nullableBoolean(record.fallbackUsed),
    error: nullableText(record.errorReason),
    retryCount: nullableCount(record.retryCount),
    template: nullableText(record.template),
    reminderWindow: nullableText(record.reminderWindow),
    relationship: nullableText(record.relationship),
    relationshipId: nullableText(record.relationshipId),
    channel: nullableText(record.channel),
    group: notificationGroup(record),
    createdAt,
    updatedAt,
  };
}

export function mapNotificationActivity(payload: NotificationActivityPayload | null | undefined) {
  const emailRecords = Array.isArray(payload?.email?.records) ? payload.email.records : [];
  const smsRecords = Array.isArray(payload?.sms?.records) ? payload.sms.records : [];
  return [...emailRecords, ...smsRecords].map(mapStoredNotification);
}

function emptySummary() {
  return { delivered: 0, pending: 0, failed: 0, bounced: 0, retried: 0, fallbackUsed: 0, accepted: 0 };
}

export function summarizeNotifications(records: EnterpriseNotificationRecord[]) {
  const summary = emptySummary();
  const groups = Object.fromEntries(NOTIFICATION_GROUPS.map((group) => [group, 0])) as Record<NotificationGroup, number>;
  for (const record of records) {
    groups[record.group] += 1;
    if (record.status === "delivered") summary.delivered += 1;
    else if (record.status === "pending") summary.pending += 1;
    else if (record.status === "failed") summary.failed += 1;
    else if (record.status === "bounced") summary.bounced += 1;
    else if (record.status === "accepted") summary.accepted += 1;
    if (record.retryCount != null && record.retryCount > 0) summary.retried += 1;
    if (record.fallbackUsed === true) summary.fallbackUsed += 1;
  }
  return { summary, groups };
}

export function hqNotificationProviderSignals(env: NodeJS.ProcessEnv = process.env) {
  const postmarkConfigured = Boolean((env.POSTMARK_SERVER_TOKEN || "").trim());
  const twilioConfigured = Boolean((env.TWILIO_ACCOUNT_SID || "").trim() && (env.TWILIO_AUTH_TOKEN || "").trim());
  const messagingServiceConfigured = Boolean((env.TWILIO_MESSAGING_SERVICE_SID || "").trim());
  const resendConfigured = Boolean((env.RESEND_API_KEY || "").trim());
  return { postmarkConfigured, twilioConfigured, messagingServiceConfigured, resendConfigured };
}

function providerCard(records: EnterpriseNotificationRecord[], signals: ReturnType<typeof hqNotificationProviderSignals>) {
  return {
    postmark: {
      role: "primary",
      scope: "transactional_email",
      configured: signals.postmarkConfigured,
      recentStored: records.some((record) => record.provider === "postmark"),
      status: signals.postmarkConfigured ? "configured" : "not_configured",
    },
    twilio: {
      role: "primary",
      scope: "sms_voice",
      configured: signals.twilioConfigured,
      messagingServiceConfigured: signals.messagingServiceConfigured,
      recentStored: records.some((record) => record.channel === "sms"),
      status: signals.twilioConfigured ? "configured" : "not_configured",
    },
    resend: {
      role: "legacy",
      scope: "non_critical_fallback",
      configured: signals.resendConfigured,
      recentStored: records.some((record) => record.provider === "resend"),
      status: signals.resendConfigured ? "legacy" : "not_configured",
    },
  };
}

export const HQ_GRANT_NOTIFICATIONS_SQL =
  "SELECT id, grant_entity_type, grant_entity_id, notification_type, created_at FROM grant_notifications WHERE 1=1"
  + excludeQuarantinedLinkedOpportunitySql("grant_entity_id")
  + " ORDER BY created_at DESC LIMIT 50";

export const HQ_NOTIFICATION_QUEUE_SQL =
  "SELECT id, notification_type, status, channel, target_email, created_at, delivered_at FROM hq_notification_queue ORDER BY created_at DESC LIMIT 50";

export const HQ_LEADERSHIP_ALERTS_SQL =
  "SELECT id, alert_type, source_module, source_id, created_at FROM hq_leadership_alerts ORDER BY created_at DESC LIMIT 50";

function hqAlertGroup(alertType: string): NotificationGroup {
  const blob = alertType.toLowerCase();
  if (blob.includes("health") || blob.includes("monitor")) return "system_health";
  if (blob.includes("security") || blob.includes("password")) return "account_security";
  if (blob.includes("founder")) return "founder";
  return "in_app";
}

function mapGrantNotification(row: Record<string, unknown>): StoredNotificationRecord | null {
  if (isQuarantinedQaOpportunity(row.grant_entity_id)) return null;
  return {
    channel: "in_app",
    notificationType: nullableText(row.notification_type),
    recipient: null,
    bookingId: null,
    eventId: nullableText(row.grant_entity_id),
    provider: null,
    providerMessageId: null,
    createdAt: nullableText(row.created_at),
    updatedAt: null,
    status: null,
    storedStatus: null,
    retryCount: null,
    fallbackUsed: null,
    errorReason: null,
    template: nullableText(row.notification_type),
    reminderWindow: null,
    originatingApp: "headquarters",
    group: "grant",
  };
}

function mapQueuedNotification(row: Record<string, unknown>): StoredNotificationRecord {
  const grouped = notificationGroup({
    notificationType: nullableText(row.notification_type),
    template: nullableText(row.notification_type),
  });
  return {
    channel: nullableText(row.channel) || "in_app",
    notificationType: nullableText(row.notification_type),
    recipient: nullableText(row.target_email),
    bookingId: null,
    provider: null,
    providerMessageId: null,
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.delivered_at),
    status: nullableText(row.status),
    storedStatus: nullableText(row.status),
    retryCount: null,
    fallbackUsed: null,
    errorReason: null,
    template: nullableText(row.notification_type),
    reminderWindow: null,
    originatingApp: "headquarters",
    group: grouped === "other" ? "in_app" : grouped,
  };
}

function mapLeadershipAlert(row: Record<string, unknown>): StoredNotificationRecord {
  const alertType = nullableText(row.alert_type) || "";
  return {
    channel: "in_app",
    notificationType: alertType || null,
    recipient: null,
    bookingId: null,
    eventId: nullableText(row.source_id),
    provider: null,
    providerMessageId: null,
    createdAt: nullableText(row.created_at),
    updatedAt: null,
    status: null,
    storedStatus: null,
    retryCount: null,
    fallbackUsed: null,
    errorReason: null,
    template: alertType || null,
    reminderWindow: null,
    originatingApp: "headquarters",
    relationship: nullableText(row.source_module),
    group: hqAlertGroup(alertType),
  };
}

export interface HqInAppRead {
  grantNotifications: "stored" | "unavailable";
  inAppQueue: "stored" | "unavailable";
  leadershipAlerts: "stored" | "unavailable";
  records: StoredNotificationRecord[];
}

async function selectRows(query: { all: (sql: string) => Promise<unknown[]> }, sql: string) {
  if (!/^SELECT\b/i.test(sql) || /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql)) {
    throw new Error("notification read rejected");
  }
  const rows = await query.all(sql);
  return Array.isArray(rows) ? rows : [];
}

export async function readHqInAppNotifications(query: { all: (sql: string) => Promise<unknown[]> }): Promise<HqInAppRead> {
  const records: StoredNotificationRecord[] = [];
  let grantNotifications: HqInAppRead["grantNotifications"] = "unavailable";
  let inAppQueue: HqInAppRead["inAppQueue"] = "unavailable";
  let leadershipAlerts: HqInAppRead["leadershipAlerts"] = "unavailable";
  try {
    const rows = await selectRows(query, HQ_GRANT_NOTIFICATIONS_SQL);
    grantNotifications = "stored";
    for (const row of rows) {
      const mapped = mapGrantNotification(row as Record<string, unknown>);
      if (mapped) records.push(mapped);
    }
  } catch { /* table missing or unreadable; do not create it */ }
  try {
    const rows = await selectRows(query, HQ_NOTIFICATION_QUEUE_SQL);
    inAppQueue = "stored";
    for (const row of rows) records.push(mapQueuedNotification(row as Record<string, unknown>));
  } catch { /* table missing or unreadable; do not create it */ }
  try {
    const rows = await selectRows(query, HQ_LEADERSHIP_ALERTS_SQL);
    leadershipAlerts = "stored";
    for (const row of rows) records.push(mapLeadershipAlert(row as Record<string, unknown>));
  } catch { /* table missing or unreadable; do not create it */ }
  return { grantNotifications, inAppQueue, leadershipAlerts, records };
}

export function buildEnterpriseNotificationView(input: {
  activity: NotificationActivityPayload | null;
  responseTimeMs: number | null;
  available: boolean;
  group?: string | null;
  signals?: ReturnType<typeof hqNotificationProviderSignals>;
  hqInApp?: HqInAppRead | null;
}) {
  const records = [
    ...mapNotificationActivity(input.activity),
    ...(input.hqInApp?.records ?? []).map(mapStoredNotification),
  ];
  const { summary, groups } = summarizeNotifications(records);
  const requested = NOTIFICATION_GROUPS.includes(input.group as NotificationGroup)
    ? input.group as NotificationGroup
    : null;
  const visible = requested ? records.filter((record) => record.group === requested) : records;
  return {
    readOnly: true,
    responseTimeMs: input.responseTimeMs,
    source: input.available ? "barbers" : "unavailable",
    emailClaimsAvailable: input.activity?.email?.available === true,
    smsLogsAvailable: input.activity?.sms?.available === true,
    grantNotifications: input.hqInApp?.grantNotifications ?? "unavailable",
    inAppQueue: input.hqInApp?.inAppQueue ?? "unavailable",
    leadershipAlerts: input.hqInApp?.leadershipAlerts ?? "unavailable",
    accountSecurityMail: "unavailable",
    providers: providerCard(records, input.signals ?? hqNotificationProviderSignals()),
    summary,
    groups,
    filter: requested,
    records: visible,
  };
}

export async function fetchBarbersNotificationActivity(options: {
  healthUrl?: string;
  readToken?: string;
  fetchImpl?: FetchImpl;
} = {}) {
  const healthUrl = options.healthUrl ?? process.env.HQ_BARBERS_HEALTH_URL;
  const readToken = (options.readToken ?? process.env[READ_TOKEN_ENV] ?? "").trim();
  const origin = barbersOriginFromHealthUrl(healthUrl);
  if (!origin || !readToken) {
    return { responseTimeMs: null as number | null, available: false, activity: null as NotificationActivityPayload | null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFICATION_ACTIVITY_FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await (options.fetchImpl ?? fetch)(`${origin.origin}/api/hq/notification-activity`, {
      method: "GET",
      headers: { Accept: "application/json", [READ_HEADER]: readToken },
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - started;
    if (!response.ok) return { responseTimeMs, available: false, activity: null };
    const activity = await response.json() as NotificationActivityPayload;
    return { responseTimeMs, available: true, activity };
  } catch {
    return { responseTimeMs: Date.now() - started, available: false, activity: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadEnterpriseNotificationVisibility(options: {
  group?: string | null;
  healthUrl?: string;
  readToken?: string;
  fetchImpl?: FetchImpl;
  env?: NodeJS.ProcessEnv;
  query?: { all: (sql: string) => Promise<unknown[]> };
} = {}) {
  const fetched = await fetchBarbersNotificationActivity(options);
  let hqInApp: HqInAppRead = {
    grantNotifications: "unavailable",
    inAppQueue: "unavailable",
    leadershipAlerts: "unavailable",
    records: [],
  };
  try {
    const db = options.query ?? await getDb();
    hqInApp = await readHqInAppNotifications(db);
  } catch { /* database unread; leave HQ categories unavailable */ }
  return buildEnterpriseNotificationView({
    activity: fetched.activity,
    responseTimeMs: fetched.responseTimeMs,
    available: fetched.available,
    group: options.group,
    signals: hqNotificationProviderSignals(options.env),
    hqInApp,
  });
}

/**
 * Answers Founder questions from an already loaded read model.
 * Counts and booking ids only. No recipient, no send, no retry, no cancel.
 */
export function answerEnterpriseNotificationQuestions(records: EnterpriseNotificationRecord[]) {
  const failed = records.filter((record) => record.status === "failed" || record.status === "bounced");
  const received = (group: NotificationGroup) => records.filter((record) =>
    record.group === group && (record.status === "accepted" || record.status === "delivered")).length;
  return {
    readOnly: true,
    confirmationReceived: received("confirmations"),
    confirmationFailures: failed.filter((record) => record.group === "confirmations").map((record) => ({
      bookingId: record.bookingId,
      provider: record.provider,
      status: record.status,
      error: record.error,
      fallbackUsed: record.fallbackUsed,
    })),
    reminderSent: received("reminders"),
    smsDelivered: records.filter((record) => record.channel === "sms" && record.status === "delivered").length,
    providers: [...new Set(records.map((record) => record.provider).filter((provider): provider is string => Boolean(provider)))],
    fallbackUsed: records.filter((record) => record.fallbackUsed === true).length,
    bookingsWithFailures: [...new Set(failed.map((record) => record.bookingId).filter((id): id is string => Boolean(id)))],
    barberNotificationFailures: failed.filter((record) => record.group === "barber").length,
    founderAttentionFailures: failed.filter((record) => record.group === "founder" || record.group === "shop_admin").length,
  };
}
