/**
 * Enterprise notification visibility. Fixture data only.
 * No network mail, no SMS, and no provider probes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { hqAuthRequired } from "../server/middleware/hqAuth.ts";
import {
  NOTIFICATION_ACTIVITY_FETCH_TIMEOUT_MS,
  answerEnterpriseNotificationQuestions,
  buildEnterpriseNotificationView,
  fetchBarbersNotificationActivity,
  mapStoredNotification,
} from "../server/hq/enterpriseNotificationVisibility.ts";

const BOOKING_ID = "00000000-0000-4000-8000-000000000099";
const FIXTURE_TOKEN = "fixture-read-token";

function mockRes() {
  const state: { statusCode: number; body: unknown } = { statusCode: 0, body: undefined };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  };
  return { state, res: res as unknown as Response };
}

function source(name: string) {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

test("a Founder session is required and the card reads the new GET", () => {
  const unauthenticated = mockRes();
  hqAuthRequired(
    { cookies: {}, header: () => undefined } as unknown as Request,
    unauthenticated.res,
    (() => { throw new Error("next should not run"); }) as NextFunction,
  );
  assert.equal(unauthenticated.state.statusCode, 401);

  const routes = source("../server/routes/communications.routes.ts");
  const authAt = routes.indexOf("router.use(hqAuthRequired, requireHQModule(\"notifications\"))");
  const viewAt = routes.indexOf("router.get(\"/enterprise-notifications\"");
  assert.equal(authAt >= 0 && viewAt > authAt, true);

  const broadcast = source("../server/routes/hq.routes.ts");
  assert.equal(broadcast.includes("router.post(\"/notifications/broadcast\""), true);
  assert.equal(broadcast.includes("router.get(\"/notifications/broadcast\""), false);

  const framework = source("../server/hq/softwareDivisionFramework.ts");
  assert.equal(
    framework.includes("endpoint: \"/api/hq/communications/enterprise-notifications\""),
    true,
  );
  assert.equal(framework.includes("\"/api/hq/notifications/broadcast\""), false);
  const page = source("../client/src/pages/hq/SoftwareDivisionPage.tsx");
  const card = source("../client/src/pages/hq/CommunicationsCenterPage.tsx");
  const api = source("../client/src/api/communicationsApi.ts");
  assert.equal(page.includes("/hq/communications#enterprise-notifications"), true);
  assert.equal(card.includes("communicationsApi.enterpriseNotifications"), true);
  assert.equal(api.includes("method: \"POST\""), true);
  assert.equal(api.includes("\"/api/hq/notifications/broadcast\""), true);
  assert.equal(card.includes("/api/hq/notifications/broadcast"), false);

  const visibility = source("../server/hq/enterpriseNotificationVisibility.ts");
  assert.equal(visibility.includes("email/status"), false);
  assert.equal(visibility.includes("restoreEmergencyResendSender"), false);
  assert.equal(NOTIFICATION_ACTIVITY_FETCH_TIMEOUT_MS, 35000);
  const snapshot = source("../server/hq/barbersOperationsSnapshot.ts");
  assert.equal(snapshot.includes("export const BARBERS_SNAPSHOT_FETCH_TIMEOUT_MS = 35000"), true);
  assert.equal(snapshot.includes("notification-activity"), false);
});

test("claims and SMS logs become card fields and missing columns stay null", () => {
  const claim = mapStoredNotification({
    channel: "email",
    notificationType: "booking_confirmation",
    template: "booking_confirmation",
    recipient: null,
    bookingId: BOOKING_ID,
    relationship: "customer",
    provider: "postmark",
    providerMessageId: "pm-fixture-1",
    createdAt: null,
    updatedAt: "2026-10-06T12:00:00.000Z",
    status: "accepted",
    storedStatus: "sent",
    retryCount: null,
    fallbackUsed: false,
    errorReason: null,
    reminderWindow: null,
    originatingApp: "barbers",
  });
  assert.equal(claim.recipient, null);
  assert.equal(claim.createdAt, null);
  assert.equal(claim.retryCount, null);
  assert.equal(claim.error, null);
  assert.equal(claim.fallbackUsed, false);
  assert.equal(claim.providerMessageId, "pm-fixture-1");
  assert.equal(claim.provider, "postmark");
  assert.equal(claim.bookingId, BOOKING_ID);
  assert.equal(claim.group, "confirmations");
  assert.equal(claim.status, "accepted");

  const view = buildEnterpriseNotificationView({
    available: true,
    responseTimeMs: 12,
    signals: {
      postmarkConfigured: true,
      twilioConfigured: false,
      messagingServiceConfigured: false,
      resendConfigured: true,
    },
    activity: {
      email: {
        available: true,
        records: [{
          channel: "email",
          notificationType: "booking_confirmation",
          template: "booking_confirmation",
          recipient: null,
          bookingId: BOOKING_ID,
          relationship: "customer",
          provider: "postmark",
          providerMessageId: "pm-fixture-1",
          createdAt: null,
          updatedAt: "2026-10-06T12:00:00.000Z",
          status: "accepted",
          storedStatus: "sent",
          retryCount: null,
          fallbackUsed: false,
          errorReason: null,
          reminderWindow: null,
          originatingApp: "barbers",
        }],
      },
      sms: {
        available: true,
        records: [{
          channel: "sms",
          notificationType: "booking_reminder",
          template: "booking_reminder",
          recipient: "founder-test@example.com",
          bookingId: BOOKING_ID,
          provider: null,
          providerMessageId: "SM-fixture",
          status: "delivered",
          storedStatus: "delivered",
          fallbackUsed: true,
          errorReason: null,
          retryCount: null,
          reminderWindow: "24h",
          createdAt: "2026-10-06T11:00:00.000Z",
          updatedAt: "2026-10-06T11:05:00.000Z",
          originatingApp: "barbers",
        }, {
          channel: "sms",
          notificationType: "booking_canceled",
          template: "booking_canceled",
          status: "failed",
          provider: null,
          providerMessageId: null,
          fallbackUsed: null,
          retryCount: null,
          recipient: null,
          bookingId: null,
          errorReason: "carrier",
          originatingApp: "barbers",
        }],
      },
    },
  });

  assert.equal(view.emailClaimsAvailable, true);
  assert.equal(view.smsLogsAvailable, true);
  assert.equal(view.summary.accepted, 1);
  assert.equal(view.summary.delivered, 1);
  assert.equal(view.summary.failed, 1);
  assert.equal(view.summary.fallbackUsed, 1);
  assert.equal(view.summary.retried, 0);
  assert.equal(view.summary.bounced, 0);
  assert.equal(view.records[1].provider, null);
  assert.equal(view.records[1].providerMessageId, "SM-fixture");
  assert.equal(view.records[1].fallbackUsed, true);
  assert.equal(view.records[1].reminderWindow, "24h");
  assert.equal(view.records[1].group, "reminders");
  assert.equal(view.records[2].recipient, null);
  assert.equal(view.records[2].fallbackUsed, null);
  assert.equal(view.records[2].error, "carrier");
  assert.equal(view.providers.postmark.role, "primary");
  assert.equal(view.providers.resend.role, "legacy");
  assert.equal(view.providers.twilio.recentStored, true);
  assert.equal(JSON.stringify(view).includes(FIXTURE_TOKEN), false);

  const reminders = buildEnterpriseNotificationView({
    available: true,
    responseTimeMs: 1,
    group: "reminders",
    activity: viewToActivity(view),
  });
  assert.equal(reminders.records.length, 1);
  assert.equal(reminders.records[0].group, "reminders");
});

function viewToActivity(view: ReturnType<typeof buildEnterpriseNotificationView>) {
  return {
    email: { available: true, records: [] as never[] },
    sms: {
      available: true,
      records: view.records.filter((record) => record.channel === "sms").map((record) => ({
        channel: record.channel,
        notificationType: record.type,
        template: record.template,
        recipient: record.recipient,
        bookingId: record.bookingId,
        provider: record.provider,
        providerMessageId: record.providerMessageId,
        status: record.status,
        fallbackUsed: record.fallbackUsed,
        errorReason: record.error,
        retryCount: record.retryCount,
        reminderWindow: record.reminderWindow,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        originatingApp: record.originatingApp,
      })),
    },
  };
}

test("the HQ read uses the snapshot token and timeout without returning the token", async () => {
  let seenUrl = "";
  let seenToken = "";
  const fetched = await fetchBarbersNotificationActivity({
    healthUrl: "https://barbers.example.test/health",
    readToken: FIXTURE_TOKEN,
    fetchImpl: async (url, init) => {
      seenUrl = url;
      seenToken = new Headers(init?.headers).get("x-ifcdc-hq-read-token") || "";
      return new Response(JSON.stringify({
        ok: true,
        readOnly: true,
        email: { available: true, records: [] },
        sms: { available: false, records: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(seenUrl, "https://barbers.example.test/api/hq/notification-activity");
  assert.equal(seenToken, FIXTURE_TOKEN);
  assert.equal(fetched.available, true);
  assert.equal(typeof fetched.responseTimeMs, "number");
  const view = buildEnterpriseNotificationView({
    activity: fetched.activity,
    responseTimeMs: fetched.responseTimeMs,
    available: fetched.available,
    signals: {
      postmarkConfigured: false,
      twilioConfigured: false,
      messagingServiceConfigured: false,
      resendConfigured: false,
    },
  });
  assert.equal(JSON.stringify(view).includes(FIXTURE_TOKEN), false);
  assert.equal(view.emailClaimsAvailable, true);
  assert.equal(view.smsLogsAvailable, false);
});

test("AURA answers from the read model and has no send function", () => {
  const moduleSource = source("../server/hq/enterpriseNotificationVisibility.ts");
  assert.equal(/\bexport\s+(async\s+)?function\s+send\b|\bretryNotification\b|\bcancelNotification\b/.test(moduleSource), false);
  const context = source("../server/hq/auraExecutiveContext.ts");
  assert.equal(context.includes("answerEnterpriseNotificationQuestions("), false);

  const records = [
    mapStoredNotification({
      channel: "email",
      notificationType: "booking_confirmation",
      template: "booking_confirmation",
      bookingId: BOOKING_ID,
      provider: "postmark",
      providerMessageId: "pm-fixture-3",
      status: "failed",
      fallbackUsed: true,
      errorReason: "rejected",
      recipient: "founder-test@example.com",
      originatingApp: "barbers",
    }),
    mapStoredNotification({
      channel: "sms",
      notificationType: "booking_reminder",
      template: "booking_reminder",
      bookingId: BOOKING_ID,
      provider: null,
      providerMessageId: "SM-fixture-3",
      status: "delivered",
      fallbackUsed: null,
      originatingApp: "barbers",
    }),
    mapStoredNotification({
      channel: "email",
      notificationType: "admin_notice",
      template: "admin_notice",
      relationship: "shop_admin",
      bookingId: BOOKING_ID,
      provider: "resend",
      status: "failed",
      errorReason: "legacy",
      originatingApp: "barbers",
    }),
  ];
  const answers = answerEnterpriseNotificationQuestions(records);
  assert.equal(answers.readOnly, true);
  assert.equal(answers.confirmationReceived, 0);
  assert.equal(answers.confirmationFailures[0].error, "rejected");
  assert.equal(answers.confirmationFailures[0].fallbackUsed, true);
  assert.equal(answers.confirmationFailures[0].provider, "postmark");
  assert.equal(answers.reminderSent, 1);
  assert.equal(answers.smsDelivered, 1);
  assert.deepEqual(answers.providers, ["postmark", "resend"]);
  assert.equal(answers.fallbackUsed, 1);
  assert.deepEqual(answers.bookingsWithFailures, [BOOKING_ID]);
  assert.equal(answers.barberNotificationFailures, 0);
  assert.equal(answers.founderAttentionFailures, 1);
  assert.equal(JSON.stringify(answers).includes("founder-test@example.com"), false);
  assert.equal("send" in answers, false);
  assert.equal("retry" in answers, false);
  assert.equal("cancel" in answers, false);
});

test("HQ in-app rows are a SELECT and missing delivery fields stay null", async () => {
  const { HQ_GRANT_NOTIFICATIONS_SQL, HQ_LEADERSHIP_ALERTS_SQL, HQ_NOTIFICATION_QUEUE_SQL, readHqInAppNotifications } = await import("../server/hq/enterpriseNotificationVisibility.ts");
  const sql = [HQ_GRANT_NOTIFICATIONS_SQL, HQ_NOTIFICATION_QUEUE_SQL, HQ_LEADERSHIP_ALERTS_SQL].join("\n");
  assert.match(HQ_GRANT_NOTIFICATIONS_SQL, /^SELECT /);
  assert.match(HQ_NOTIFICATION_QUEUE_SQL, /^SELECT /);
  assert.match(HQ_LEADERSHIP_ALERTS_SQL, /^SELECT /);
  assert.equal(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql), false);
  assert.equal(sql.includes("0e864db8-4387-477a-96d6-4fdc94e04501"), true);
  const moduleSource = source("../server/hq/enterpriseNotificationVisibility.ts");
  assert.equal(moduleSource.includes("ensureNotificationQueueTables"), false);
  assert.equal(moduleSource.includes("generateGrantNotifications"), false);
  assert.equal(moduleSource.includes("enqueueNotification"), false);

  const seen: string[] = [];
  const read = await readHqInAppNotifications({
    all: async (statement) => {
      seen.push(statement);
      if (statement.includes("grant_notifications")) {
        return [
          { id: "keep", grant_entity_id: "opportunity-1", notification_type: "deadline_reminder", created_at: "2026-10-06T12:00:00.000Z" },
          { id: "drop", grant_entity_id: "0e864db8-4387-477a-96d6-4fdc94e04501", notification_type: "approval_required", created_at: "2026-10-06T12:00:00.000Z" },
        ];
      }
      if (statement.includes("hq_notification_queue")) {
        return [{ id: "q1", notification_type: "software", status: "pending", channel: "in_app", target_email: null, created_at: "2026-10-06T12:00:00.000Z", delivered_at: null }];
      }
      if (statement.includes("hq_leadership_alerts")) {
        return [{ id: "a1", alert_type: "enterprise_health_critical", source_module: "technical", source_id: "health-1", created_at: "2026-10-06T12:00:00.000Z" }];
      }
      throw new Error("unexpected sql");
    },
  });
  assert.equal(seen.length, 3);
  assert.equal(read.grantNotifications, "stored");
  assert.equal(read.records.filter((row) => row.group === "grant").length, 1);
  assert.equal(read.records.find((row) => row.group === "grant")?.status, null);
  assert.equal(read.records.find((row) => row.group === "grant")?.provider, null);
  assert.equal(read.records.find((row) => row.group === "grant")?.eventId, "opportunity-1");
  const queued = read.records.find((row) => row.notificationType === "software");
  assert.equal(queued?.status, "pending");
  assert.notEqual(queued?.status, "delivered");
  assert.equal(read.records.find((row) => row.group === "system_health")?.status, null);

  const missing = await readHqInAppNotifications({
    all: async () => { throw new Error("no such table"); },
  });
  assert.equal(missing.grantNotifications, "unavailable");
  assert.equal(missing.inAppQueue, "unavailable");
  assert.equal(missing.leadershipAlerts, "unavailable");
  assert.deepEqual(missing.records, []);
});
