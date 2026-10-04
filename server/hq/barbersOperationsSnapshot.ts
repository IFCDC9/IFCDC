/**
 * Read-only Barbers operations snapshot for Headquarters.
 * Calls GET /api/hq/operations-snapshot with HQ_BARBERS_SNAPSHOT_READ_TOKEN.
 * Never uses an admin key, never writes bookings, and never reads the HQ appointments table.
 * The token value is never logged.
 */

export type SourceHealth = "ok" | "unavailable" | "not_configured";

export interface SnapshotSection {
  status: SourceHealth;
  /** Null when the section was not read. A number, including 0, means the source answered. */
  count: number | null;
  emptyBecause: "source_returned_zero" | "closed_day" | null;
  unavailableReason: string | null;
  items: Record<string, string | number | boolean | null>[];
}

export interface BarbersOperationsSnapshot {
  todayBookings: SnapshotSection;
  upcomingBookings: SnapshotSection;
  openings: SnapshotSection;
  shopStatus: SnapshotSection;
  reschedules: SnapshotSection;
  cancellations: SnapshotSection;
  exceptions: SnapshotSection;
  refreshedAt: string | null;
  sourceHealth: SourceHealth;
  source: { host: string };
}

export interface BarbersSlotDay {
  date: string;
  barberName: string;
  available: number;
  bookedSlots: number;
  reasonIfEmpty: string | null;
  usedFallback: boolean;
}

export interface BarbersSnapshotReads {
  now?: string;
  host: string;
  healthOk: boolean;
  readKeyConfigured: boolean;
  ledger: "missing_credential" | "fetched" | "failed";
  bookings?: unknown;
  slotDays?: BarbersSlotDay[];
  shops?: unknown;
  /** Ignored. Headquarters appointments must never fill this snapshot. */
  hqAppointments?: unknown;
}

const CANCELLED = new Set(["cancelled", "canceled", "cancelled_by_customer", "canceled_by_customer"]);
const EXCEPTION_STATUSES = new Set(["no_show", "failed", "payment_failed", "error"]);
const READ_TOKEN_ENV = "HQ_BARBERS_SNAPSHOT_READ_TOKEN";
const READ_HEADER = "x-ifcdc-hq-read-token";
const FETCH_TIMEOUT_MS = 4500;
const MAX_ITEMS = 40;
const PRIVATE_KEY = /phone|email|paypal|card|cvv|ssn|password|secret|token|customer|payment|refund/i;
const BUSINESS_TZ = "America/New_York";

export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function barbersOriginFromHealthUrl(healthUrl: string | undefined): { origin: string; host: string } | null {
  const raw = healthUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { origin: url.origin, host: url.host };
  } catch {
    return null;
  }
}

function section(
  status: SourceHealth,
  count: number | null,
  unavailableReason: string | null,
  items: SnapshotSection["items"] = [],
  emptyBecause: SnapshotSection["emptyBecause"] = null,
): SnapshotSection {
  return {
    status,
    count,
    emptyBecause: status === "ok" && count === 0 ? emptyBecause ?? "source_returned_zero" : emptyBecause,
    unavailableReason,
    items: items.slice(0, MAX_ITEMS),
  };
}

function notConfigured(reason: string): SnapshotSection {
  return section("not_configured", null, reason);
}

function unavailable(reason: string): SnapshotSection {
  return section("unavailable", null, reason);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bookingRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
  const record = asRecord(payload);
  const rows = record?.bookings ?? record?.rows ?? record?.data;
  return asArray(rows).map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
}

function publicBooking(row: Record<string, unknown>): Record<string, string | null> {
  const status = text(row.booking_status ?? row.bookingStatus ?? row.status).toLowerCase();
  return {
    id: text(row.id) || null,
    date: text(row.date).slice(0, 10) || null,
    time: text(row.time) || null,
    barberName: text(row.barber_name ?? row.barberName) || null,
    service: text(row.service) || null,
    bookingStatus: status || null,
    shopName: text(row.shop_name ?? row.shopName) || null,
  };
}

function isCancelled(status: string | null): boolean {
  return Boolean(status && (CANCELLED.has(status) || status.startsWith("cancel")));
}

function isRescheduled(row: Record<string, unknown>, status: string | null): boolean {
  if (status && status.includes("reschedul")) return true;
  return text(row.rescheduled_at ?? row.rescheduledAt).length > 0;
}

function shopRows(payload: unknown): SnapshotSection["items"] {
  const record = asRecord(payload);
  const rows = Array.isArray(payload) ? payload : asArray(record?.shops ?? record?.locations ?? record?.businesses);
  return rows.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row)).map((row) => ({
    name: text(row.name ?? row.shop_name ?? row.shopName) || null,
    status: text(row.status ?? row.shop_status ?? row.locationStatus) || null,
  })).filter((row) => row.name || row.status);
}

export function mapBarbersOperationsSnapshot(reads: BarbersSnapshotReads): BarbersOperationsSnapshot {
  const now = reads.now ? new Date(reads.now) : new Date();
  const today = businessToday(now);
  const host = reads.host || "unconfigured";
  const ledgerReason = "Barbers snapshot read token is not configured. Headquarters appointments are not used.";
  const shopReason = "Barbers shop list requires a read credential. The public catalog has no shop status.";

  let todayBookings = notConfigured(ledgerReason);
  let upcomingBookings = notConfigured(ledgerReason);
  let reschedules = notConfigured(ledgerReason);
  let cancellations = notConfigured(ledgerReason);
  let exceptions = notConfigured("Operational exceptions require the Barbers booking ledger.");
  let shopStatus = notConfigured(shopReason);
  let openings = unavailable("Barber openings were not read.");
  let sourceHealth: SourceHealth = "not_configured";
  let refreshedAt: string | null = null;

  if (!reads.healthOk && reads.ledger !== "fetched") {
    const missingConfig = !reads.host || reads.ledger === "missing_credential";
    const reason = !reads.host
      ? "HQ_BARBERS_HEALTH_URL is not set."
      : reads.ledger === "missing_credential"
        ? "HQ_BARBERS_SNAPSHOT_READ_TOKEN is not set. Headquarters appointments are not used."
        : "Barbers operations snapshot did not respond.";
    const blocked = missingConfig ? notConfigured(reason) : unavailable(reason);
    return {
      todayBookings: blocked,
      upcomingBookings: blocked,
      openings: blocked,
      shopStatus: blocked,
      reschedules: blocked,
      cancellations: blocked,
      exceptions: blocked,
      refreshedAt: null,
      sourceHealth: missingConfig ? "not_configured" : "unavailable",
      source: { host },
    };
  }

  if (reads.healthOk) refreshedAt = now.toISOString();

  const days = reads.slotDays ?? [];
  const realDays = days.filter((day) => !day.usedFallback);
  const fallbackDays = days.filter((day) => day.usedFallback);
  if (realDays.length > 0) {
    const items = realDays.map((day) => ({
      date: day.date,
      barberName: day.barberName || null,
      available: day.available,
      reason: day.reasonIfEmpty,
    }));
    const available = realDays.reduce((sum, day) => sum + day.available, 0);
    const closedOnly = available === 0 && realDays.every((day) => day.reasonIfEmpty === "closed_day");
    openings = section(
      "ok",
      available,
      null,
      items,
      available === 0 ? (closedOnly ? "closed_day" : "source_returned_zero") : null,
    );
  } else if (days.length > 0 && fallbackDays.length === days.length) {
    openings = unavailable("Barbers returned a demo fallback schedule. Those openings are not live.");
  }

  const mappedShops = shopRows(reads.shops);
  if (reads.shops != null && mappedShops.length > 0) {
    shopStatus = section("ok", mappedShops.length, null, mappedShops);
  } else if (reads.shops != null) {
    shopStatus = section("ok", 0, null, [], "source_returned_zero");
  }

  if (reads.ledger === "failed") {
    sourceHealth = "unavailable";
    const reason = "Barbers booking ledger did not respond.";
    todayBookings = unavailable(reason);
    upcomingBookings = unavailable(reason);
    reschedules = unavailable(reason);
    cancellations = unavailable(reason);
    exceptions = unavailable(reason);
  } else if (reads.ledger === "fetched") {
    sourceHealth = "ok";
    const rows = bookingRows(reads.bookings);
    const publicRows = rows.map((row) => ({ raw: row, view: publicBooking(row) }));
    const cancelled = publicRows.filter((row) => isCancelled(row.view.bookingStatus));
    const rescheduled = publicRows.filter((row) => isRescheduled(row.raw, row.view.bookingStatus));
    const active = publicRows.filter((row) => !isCancelled(row.view.bookingStatus) && !isRescheduled(row.raw, row.view.bookingStatus));
    const todayRows = active.filter((row) => row.view.date === today);
    const upcomingRows = active.filter((row) => Boolean(row.view.date && row.view.date > today));
    todayBookings = section("ok", todayRows.length, null, todayRows.map((row) => row.view));
    upcomingBookings = section("ok", upcomingRows.length, null, upcomingRows.map((row) => row.view));
    cancellations = section("ok", cancelled.length, null, cancelled.map((row) => row.view));

    const rescheduleFieldPresent = rows.some((row) =>
      "rescheduled_at" in row || "rescheduledAt" in row || text(row.booking_status ?? row.bookingStatus ?? row.status).toLowerCase().includes("reschedul"),
    );
    reschedules = rescheduleFieldPresent
      ? section("ok", rescheduled.length, null, rescheduled.map((row) => row.view))
      : unavailable("Barbers admin booking list has no reschedule field. Count was not invented.");

    const exceptionItems: SnapshotSection["items"] = [];
    for (const row of publicRows) {
      const status = row.view.bookingStatus;
      if (status && EXCEPTION_STATUSES.has(status)) {
        exceptionItems.push({
          kind: status,
          date: row.view.date,
          time: row.view.time,
          barberName: row.view.barberName,
          service: row.view.service,
        });
      }
    }
    if (fallbackDays.length > 0) {
      exceptionItems.push({
        kind: "demo_schedule_ignored",
        date: null,
        time: null,
        barberName: null,
        service: null,
      });
    }
    exceptions = section("ok", exceptionItems.length, null, exceptionItems);
  }

  return {
    todayBookings,
    upcomingBookings,
    openings,
    shopStatus,
    reschedules,
    cancellations,
    exceptions,
    refreshedAt,
    sourceHealth,
    source: { host },
  };
}

interface LoadOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  env?: { healthUrl?: string; readToken?: string };
}

const SECTION_KEYS = [
  "todayBookings",
  "upcomingBookings",
  "openings",
  "shopStatus",
  "reschedules",
  "cancellations",
  "exceptions",
] as const;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEY.test(key)) continue;
    out[key] = redactValue(child);
  }
  return out;
}

function remoteSection(value: unknown): SnapshotSection {
  const row = asRecord(redactValue(value));
  if (!row) return notConfigured("Barbers snapshot did not include this section.");
  const statusRaw = text(row.status);
  if (statusRaw !== "ok") {
    const status: SourceHealth = statusRaw === "unavailable" ? "unavailable" : "not_configured";
    return section(status, null, text(row.unavailableReason) || "This section was not connected.", []);
  }
  if (typeof row.count !== "number") {
    return notConfigured("Barbers did not return a count for this section.");
  }
  const items = asArray(row.items).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => {
    const clean: SnapshotSection["items"][number] = {};
    for (const [key, child] of Object.entries(item)) {
      if (typeof child === "string" || typeof child === "number" || typeof child === "boolean" || child === null) {
        clean[key] = child;
      }
    }
    return clean;
  });
  const emptyBecause = row.emptyBecause === "closed_day" || row.emptyBecause === "source_returned_zero"
    ? row.emptyBecause
    : null;
  return section("ok", row.count, null, items, emptyBecause);
}

export function normalizeRemoteBarbersSnapshot(body: unknown, host: string): BarbersOperationsSnapshot {
  const row = asRecord(redactValue(body)) ?? {};
  const snapshot = {} as BarbersOperationsSnapshot;
  for (const key of SECTION_KEYS) {
    snapshot[key] = remoteSection(row[key]);
  }
  const health = text(row.sourceHealth);
  snapshot.sourceHealth = health === "ok" || health === "unavailable" || health === "not_configured" ? health : "unavailable";
  snapshot.refreshedAt = text(row.refreshedAt) || null;
  snapshot.source = { host: host || "unconfigured" };
  if (snapshot.sourceHealth !== "ok") {
    for (const key of SECTION_KEYS) {
      if (snapshot[key].status === "ok") continue;
      snapshot[key] = {
        ...snapshot[key],
        count: null,
      };
    }
  }
  return snapshot;
}

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetchImpl(url, { method: "GET", headers, signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

export async function loadBarbersOperationsSnapshot(options: LoadOptions = {}): Promise<BarbersOperationsSnapshot> {
  const healthUrl = options.env?.healthUrl ?? process.env.HQ_BARBERS_HEALTH_URL;
  const readToken = (options.env?.readToken ?? process.env[READ_TOKEN_ENV] ?? "").trim();
  const origin = barbersOriginFromHealthUrl(healthUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!origin || !readToken) {
    return mapBarbersOperationsSnapshot({
      now: (options.now ?? new Date()).toISOString(),
      host: origin?.host || "",
      healthOk: false,
      readKeyConfigured: false,
      ledger: "missing_credential",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const payload = await readJson(
      fetchImpl,
      `${origin.origin}/api/hq/operations-snapshot`,
      { Accept: "application/json", [READ_HEADER]: readToken },
      controller.signal,
    );
    if (!payload || payload.status !== 200) {
      return mapBarbersOperationsSnapshot({
        now: (options.now ?? new Date()).toISOString(),
        host: origin.host,
        healthOk: false,
        readKeyConfigured: true,
        ledger: "failed",
      });
    }
    return normalizeRemoteBarbersSnapshot(payload.body, origin.host);
  } finally {
    clearTimeout(timer);
  }
}
