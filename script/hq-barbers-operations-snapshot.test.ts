/**
 * Read-only Barbers operations snapshot.
 * No network, no mail, no booking writes, no production unlock.
 * HTTP coverage is the shared HQ auth middleware, not a booted Founder session.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { hqAuthRequired } from "../server/middleware/hqAuth.ts";
import {
  BARBERS_SNAPSHOT_FETCH_TIMEOUT_MS,
  loadBarbersOperationsSnapshot,
  mapBarbersOperationsSnapshot,
} from "../server/hq/barbersOperationsSnapshot.ts";

const fixtureToken = randomBytes(32).toString("hex");

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

test("unauthenticated HQ middleware stays 401", () => {
  const unauthenticated = mockRes();
  hqAuthRequired(
    { cookies: {}, header: () => undefined } as unknown as Request,
    unauthenticated.res,
    (() => { throw new Error("next should not run"); }) as NextFunction,
  );
  assert.equal(unauthenticated.state.statusCode, 401);
  assert.deepEqual(unauthenticated.state.body, { error: "Authentication required" });
});

test("fixture Barbers payload maps the operations snapshot without customer fields", () => {
  const snapshot = mapBarbersOperationsSnapshot({
    now: "2026-10-04T15:00:00.000Z",
    host: "ifcdc-barbers-backend696.onrender.com",
    healthOk: true,
    readKeyConfigured: true,
    ledger: "fetched",
    hqAppointments: [{ id: "hq-row", date: "2026-10-04", customer_email: "hq@example.com" }],
    shops: [{ name: "Main Street", status: "open" }],
    slotDays: [
      { date: "2026-10-04", barberName: "Alex", available: 0, bookedSlots: 9, reasonIfEmpty: "closed_day", usedFallback: false },
      { date: "2026-10-05", barberName: "Alex", available: 24, bookedSlots: 0, reasonIfEmpty: null, usedFallback: false },
    ],
    bookings: {
      bookings: [
        {
          id: "today-1",
          date: "2026-10-04",
          time: "10:00 AM",
          barber_name: "Alex",
          service: "Haircut",
          booking_status: "confirmed",
          customer_name: "Hidden Customer",
          customer_email: "hidden@example.com",
          phone: "555-0100",
        },
        {
          id: "upcoming-1",
          date: "2026-10-06",
          time: "11:00 AM",
          barber_name: "Alex",
          service: "Beard",
          booking_status: "confirmed",
        },
        {
          id: "cancel-1",
          date: "2026-10-04",
          time: "12:00 PM",
          barber_name: "Alex",
          service: "Haircut",
          booking_status: "cancelled",
        },
        {
          id: "exception-1",
          date: "2026-10-05",
          time: "1:00 PM",
          barber_name: "Alex",
          service: "Haircut",
          booking_status: "no_show",
        },
        {
          id: "reschedule-1",
          date: "2026-10-07",
          time: "2:00 PM",
          barber_name: "Alex",
          service: "Haircut",
          booking_status: "rescheduled",
          rescheduled_at: "2026-10-01T12:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(snapshot.sourceHealth, "ok");
  assert.equal(snapshot.source.host, "ifcdc-barbers-backend696.onrender.com");
  assert.equal(snapshot.refreshedAt, "2026-10-04T15:00:00.000Z");
  assert.equal(snapshot.todayBookings.status, "ok");
  assert.equal(snapshot.todayBookings.count, 1);
  assert.equal(snapshot.upcomingBookings.count, 2);
  assert.equal(snapshot.cancellations.count, 1);
  assert.equal(snapshot.reschedules.count, 1);
  assert.equal(snapshot.exceptions.count, 1);
  assert.equal(snapshot.openings.count, 24);
  assert.equal(snapshot.shopStatus.count, 1);
  assert.equal(snapshot.shopStatus.items[0]?.status, "open");

  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes("hidden@example.com"), false);
  assert.equal(encoded.includes("Hidden Customer"), false);
  assert.equal(encoded.includes("555-0100"), false);
  assert.equal(encoded.includes("hq-row"), false);
  assert.equal(encoded.includes("hq@example.com"), false);
});

test("missing read credential does not turn occupied slots or HQ appointments into bookings", () => {
  const snapshot = mapBarbersOperationsSnapshot({
    now: "2026-10-04T15:00:00.000Z",
    host: "ifcdc-barbers-backend696.onrender.com",
    healthOk: true,
    readKeyConfigured: false,
    ledger: "missing_credential",
    hqAppointments: [
      { id: "local-1", date: "2026-10-04" },
      { id: "local-2", date: "2026-10-04" },
    ],
    slotDays: [
      { date: "2026-10-04", barberName: "Alex", available: 0, bookedSlots: 9, reasonIfEmpty: "closed_day", usedFallback: false },
    ],
  });

  assert.equal(snapshot.sourceHealth, "not_configured");
  assert.equal(snapshot.todayBookings.status, "not_configured");
  assert.equal(snapshot.todayBookings.count, null);
  assert.equal(snapshot.upcomingBookings.count, null);
  assert.equal(snapshot.cancellations.count, null);
  assert.equal(snapshot.reschedules.count, null);
  assert.equal(snapshot.shopStatus.status, "not_configured");
  assert.equal(snapshot.openings.status, "ok");
  assert.equal(snapshot.openings.count, 0);
  assert.equal(snapshot.openings.emptyBecause, "closed_day");
  assert.equal(JSON.stringify(snapshot).includes("local-1"), false);
});

test("failed snapshot fetch stays unavailable and does not report zero bookings", async () => {
  let calls = 0;
  const snapshot = await loadBarbersOperationsSnapshot({
    now: new Date("2026-10-04T15:00:00.000Z"),
    env: {
      healthUrl: "https://ifcdc-barbers-backend696.onrender.com/api/health",
      readToken: fixtureToken,
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network down");
    },
  });

  assert.equal(calls, 1);
  assert.equal(snapshot.sourceHealth, "unavailable");
  assert.equal(snapshot.todayBookings.status, "unavailable");
  assert.equal(snapshot.todayBookings.count, null);
  assert.equal(snapshot.refreshedAt, null);
  assert.equal(typeof snapshot.responseTimeMs, "number");
  assert.equal((snapshot.responseTimeMs ?? -1) >= 0, true);
});

test("unset snapshot token does not fetch admin or appointment data", async () => {
  let calls = 0;
  const snapshot = await loadBarbersOperationsSnapshot({
    now: new Date("2026-10-04T15:00:00.000Z"),
    env: { healthUrl: "https://ifcdc-barbers-backend696.onrender.com/api/health", readToken: "" },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("fetch should not run");
    },
  });

  assert.equal(calls, 0);
  assert.equal(snapshot.sourceHealth, "not_configured");
  assert.equal(snapshot.todayBookings.count, null);
  assert.equal(snapshot.todayBookings.status, "not_configured");
  assert.equal(snapshot.responseTimeMs, null);
});

test("HQ calls only the Barbers snapshot route and drops customer fields", async () => {
  let requested = "";
  let usedAdminHeader = false;
  const snapshot = await loadBarbersOperationsSnapshot({
    now: new Date("2026-10-04T15:00:00.000Z"),
    env: {
      healthUrl: "https://ifcdc-barbers-backend696.onrender.com/api/health",
      readToken: fixtureToken,
    },
    fetchImpl: async (url, init) => {
      requested = String(url);
      const headers = new Headers(init?.headers);
      usedAdminHeader = headers.has("x-admin-key");
      assert.equal(headers.get("x-ifcdc-hq-read-token") === fixtureToken, true);
      return new Response(JSON.stringify({
        sourceHealth: "ok",
        refreshedAt: "2026-10-04T15:00:00.000Z",
        todayBookings: {
          status: "ok",
          count: 1,
          emptyBecause: null,
          unavailableReason: null,
          items: [{ date: "2026-10-04", time: "10:00 AM", barberName: "Alex", customer_email: "hidden@example.com", phone: "555-0100" }],
        },
        upcomingBookings: { status: "not_connected", count: null, items: [] },
        openings: { status: "ok", count: 24, emptyBecause: null, unavailableReason: null, items: [{ date: "2026-10-05", available: 24 }] },
        shopStatus: { status: "ok", count: 1, emptyBecause: null, unavailableReason: null, items: [{ name: "Main", status: "active" }] },
        reschedules: { status: "ok", count: 0, emptyBecause: "source_returned_zero", unavailableReason: null, items: [] },
        cancellations: { status: "ok", count: 0, emptyBecause: "source_returned_zero", unavailableReason: null, items: [] },
        exceptions: { status: "ok", count: 0, emptyBecause: "source_returned_zero", unavailableReason: null, items: [] },
        hqAppointments: [{ id: "local-appointment" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(requested, "https://ifcdc-barbers-backend696.onrender.com/api/hq/operations-snapshot");
  assert.equal(usedAdminHeader, false);
  assert.equal(snapshot.sourceHealth, "ok");
  assert.equal(snapshot.todayBookings.count, 1);
  assert.equal(snapshot.upcomingBookings.status, "not_configured");
  assert.equal(snapshot.upcomingBookings.count, null);
  assert.equal(snapshot.openings.count, 24);
  assert.equal(snapshot.shopStatus.count, 1);
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes("hidden@example.com"), false);
  assert.equal(encoded.includes("555-0100"), false);
  assert.equal(encoded.includes("local-appointment"), false);
  assert.equal(encoded.includes("/api/admin/bookings"), false);
  assert.equal(typeof snapshot.responseTimeMs, "number");
});

test("this snapshot fetch times out at 35000 ms and no other timeout constant changed", () => {
  assert.equal(BARBERS_SNAPSHOT_FETCH_TIMEOUT_MS, 35000);
  assert.notEqual(BARBERS_SNAPSHOT_FETCH_TIMEOUT_MS, 4500);
  const source = readFileSync(
    fileURLToPath(new URL("../server/hq/barbersOperationsSnapshot.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /export const BARBERS_SNAPSHOT_FETCH_TIMEOUT_MS = 35000;/);
  assert.equal(source.includes("4500"), false);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), BARBERS_SNAPSHOT_FETCH_TIMEOUT_MS\)/);

  const root = fileURLToPath(new URL("..", import.meta.url));
  const diff = execFileSync("git", ["diff", "-U0", "HEAD", "--", "server", "client"], {
    cwd: root,
    encoding: "utf8",
  });
  const unexpectedTimeouts = diff.split("\n").filter((line) => {
    if ((!line.startsWith("+") && !line.startsWith("-")) || line.startsWith("+++") || line.startsWith("---")) return false;
    if (!/TIMEOUT[A-Z0-9_]*\s*=\s*\d+/.test(line)) return false;
    return !/BARBERS_SNAPSHOT_FETCH_TIMEOUT_MS = 35000/.test(line) && !/FETCH_TIMEOUT_MS = 4500/.test(line);
  });
  assert.deepEqual(unexpectedTimeouts, []);
});

test("a slow successful snapshot stays ok and records response time", async () => {
  let requested = "";
  const snapshot = await loadBarbersOperationsSnapshot({
    now: new Date("2026-10-04T15:00:00.000Z"),
    env: {
      healthUrl: "https://ifcdc-barbers-backend696.onrender.com/api/health",
      readToken: fixtureToken,
    },
    fetchImpl: async (url, init) => {
      requested = String(url);
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("x-admin-key"), false);
      assert.equal(headers.has("authorization"), false);
      assert.equal(headers.get("x-ifcdc-hq-read-token") === fixtureToken, true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(JSON.stringify({
        sourceHealth: "ok",
        refreshedAt: "2026-10-04T15:00:00.000Z",
        responseTimeMs: 1,
        todayBookings: { status: "ok", count: 2, emptyBecause: null, unavailableReason: null, items: [] },
        upcomingBookings: { status: "ok", count: 0, emptyBecause: "source_returned_zero", unavailableReason: null, items: [] },
        openings: { status: "ok", count: 3, emptyBecause: null, unavailableReason: null, items: [] },
        shopStatus: { status: "ok", count: 1, emptyBecause: null, unavailableReason: null, items: [{ name: "Main", status: "active" }] },
        reschedules: { status: "ok", count: 0, emptyBecause: "source_returned_zero", unavailableReason: null, items: [] },
        cancellations: { status: "ok", count: 0, emptyBecause: "source_returned_zero", unavailableReason: null, items: [] },
        exceptions: { status: "ok", count: 0, emptyBecause: "source_returned_zero", unavailableReason: null, items: [] },
        hqAppointments: [{ id: "hq-row" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(requested, "https://ifcdc-barbers-backend696.onrender.com/api/hq/operations-snapshot");
  assert.equal(requested.includes("/api/admin"), false);
  assert.equal(requested.includes("/cancel"), false);
  assert.equal(requested.includes("/reschedule"), false);
  assert.equal(snapshot.sourceHealth, "ok");
  assert.equal(snapshot.todayBookings.count, 2);
  assert.equal(typeof snapshot.responseTimeMs, "number");
  assert.equal((snapshot.responseTimeMs ?? 0) >= 40, true);
  assert.notEqual(snapshot.responseTimeMs, 1);
  assert.equal(JSON.stringify(snapshot).includes("hq-row"), false);
});

test("an aborted snapshot stays unavailable, records elapsed time, and does not copy Headquarters appointments", async () => {
  const requested: string[] = [];
  const snapshot = await loadBarbersOperationsSnapshot({
    now: new Date("2026-10-04T15:00:00.000Z"),
    env: {
      healthUrl: "https://ifcdc-barbers-backend696.onrender.com/api/health",
      readToken: fixtureToken,
    },
    fetchImpl: async (url) => {
      requested.push(String(url));
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  const mapped = mapBarbersOperationsSnapshot({
    now: "2026-10-04T15:00:00.000Z",
    host: "ifcdc-barbers-backend696.onrender.com",
    healthOk: false,
    readKeyConfigured: true,
    ledger: "failed",
    responseTimeMs: 35000,
    hqAppointments: [{ id: "hq-row", date: "2026-10-04", customer_email: "hq@example.com" }],
  });

  assert.deepEqual(requested, ["https://ifcdc-barbers-backend696.onrender.com/api/hq/operations-snapshot"]);
  assert.equal(snapshot.sourceHealth, "unavailable");
  assert.equal(snapshot.todayBookings.status, "unavailable");
  assert.equal(snapshot.todayBookings.count, null);
  assert.equal(typeof snapshot.responseTimeMs, "number");
  assert.equal((snapshot.responseTimeMs ?? -1) >= 0, true);
  assert.equal(mapped.sourceHealth, "unavailable");
  assert.equal(mapped.responseTimeMs, 35000);
  assert.equal(mapped.todayBookings.count, null);
  const encoded = JSON.stringify({ snapshot, mapped });
  assert.equal(encoded.includes("hq-row"), false);
  assert.equal(encoded.includes("hq@example.com"), false);
  assert.equal(encoded.includes("/api/admin"), false);
  assert.equal(encoded.includes("/cancel"), false);
  assert.equal(encoded.includes("/reschedule"), false);
});
