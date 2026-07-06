/**
 * AURA receptionist — executable actions (bookings, follow-ups, transfers).
 */
import { getMonolithDb } from "../monolith/dbAccess";
import { cryptoRandomId } from "../monolith/constants";
import { normalizePhone } from "../monolith/phoneUtils";
import type { PendingBooking } from "./auraReceptionistSession";

export type TransferTarget = "barbershop" | "executive" | "none";

export type ReceptionistActionType =
  | "none"
  | "transfer_barbershop"
  | "transfer_executive"
  | "book_barbershop"
  | "create_followup";

export type ParsedReceptionistAction = {
  type: ReceptionistActionType;
  data?: Record<string, string>;
};

const BARBERSHOP_SERVICES: Record<string, { name: string; duration: number }> = {
  haircut: { name: "Haircut", duration: 30 },
  beard: { name: "Beard Trim", duration: 15 },
  haircut_beard: { name: "Haircut + Beard", duration: 45 },
  lineup: { name: "Line Up / Edge Up", duration: 15 },
  kids_cut: { name: "Kids Cut", duration: 25 },
  shave: { name: "Full Shave", duration: 30 },
};

export const TRANSFER_NUMBERS: Record<TransferTarget, string | null> = {
  barbershop: "+17327435048",
  executive: "+17327435048",
  none: null,
};

export function parseActionMarker(raw: string): { speech: string; action: ParsedReceptionistAction } {
  const match = raw.match(/\n?\[ACTION:([^\]]+)\]\s*$/i);
  if (!match) return { speech: raw.trim(), action: { type: "none" } };

  const speech = raw.slice(0, match.index).trim();
  const payload = match[1].trim();

  if (payload === "none") return { speech, action: { type: "none" } };
  if (payload === "transfer_barbershop" || payload === "transfer:barbershop") {
    return { speech, action: { type: "transfer_barbershop" } };
  }
  if (payload === "transfer_executive" || payload === "transfer:executive" || payload === "transfer:human") {
    return { speech, action: { type: "transfer_executive" } };
  }
  if (payload === "create_followup" || payload.startsWith("followup:")) {
    const reason = payload.startsWith("followup:") ? payload.slice(9).trim() : "Caller requested callback";
    return { speech, action: { type: "create_followup", data: { reason } } };
  }

  if (payload.startsWith("book:")) {
    try {
      const data = JSON.parse(payload.slice(5)) as Record<string, string>;
      return { speech, action: { type: "book_barbershop", data } };
    } catch {
      return { speech, action: { type: "none" } };
    }
  }

  return { speech, action: { type: "none" } };
}

export function mergeBookingData(
  existing: PendingBooking | null,
  incoming: Record<string, string> | undefined,
  callerPhone?: string | null
): PendingBooking {
  const merged: PendingBooking = { ...(existing ?? {}), phone: existing?.phone || callerPhone || undefined };
  if (!incoming) return merged;
  if (incoming.firstName) merged.firstName = incoming.firstName;
  if (incoming.lastName) merged.lastName = incoming.lastName;
  if (incoming.phone) merged.phone = incoming.phone;
  if (incoming.service) merged.service = incoming.service;
  if (incoming.date) merged.date = incoming.date;
  if (incoming.time) merged.time = incoming.time;
  if (incoming.notes) merged.notes = incoming.notes;
  return merged;
}

export function bookingIsComplete(booking: PendingBooking | null): boolean {
  if (!booking) return false;
  return Boolean(booking.firstName && booking.lastName && booking.phone && booking.date && booking.time);
}

export function missingBookingFields(booking: PendingBooking | null): string[] {
  const missing: string[] = [];
  if (!booking?.firstName) missing.push("first name");
  if (!booking?.lastName) missing.push("last name");
  if (!booking?.phone) missing.push("phone number");
  if (!booking?.date) missing.push("preferred date");
  if (!booking?.time) missing.push("preferred time");
  return missing;
}

function resolveServiceId(service?: string): string {
  if (!service) return "haircut";
  const s = service.toLowerCase().replace(/\s+/g, "_");
  if (BARBERSHOP_SERVICES[s]) return s;
  if (/beard/.test(s) && /hair|cut/.test(s)) return "haircut_beard";
  if (/beard/.test(s)) return "beard";
  if (/kid|child/.test(s)) return "kids_cut";
  if (/line|edge/.test(s)) return "lineup";
  if (/shave/.test(s)) return "shave";
  return "haircut";
}

export async function bookBarbershopAppointment(booking: PendingBooking): Promise<{ ok: boolean; message: string }> {
  if (!bookingIsComplete(booking)) {
    return { ok: false, message: `Still need: ${missingBookingFields(booking).join(", ")}` };
  }

  try {
    const db = getMonolithDb();
    const phone = normalizePhone(booking.phone!) || booking.phone!;
    const fullName = `${booking.firstName} ${booking.lastName}`;
    const serviceId = resolveServiceId(booking.service);
    const service = BARBERSHOP_SERVICES[serviceId] ?? BARBERSHOP_SERVICES.haircut;

    let client = await db.get<{ id: string; notify_channel: string }>(
      "SELECT id, notify_channel FROM clients WHERE phone = ? AND phone IS NOT NULL",
      phone
    );

    if (!client) {
      const clientId = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO clients (id, full_name, phone, email, programs, notify_channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        clientId,
        fullName,
        phone,
        null,
        JSON.stringify(["BARBERSHOP"]),
        "SMS",
        now
      );
      client = { id: clientId, notify_channel: "SMS" };
    }

    const date = booking.date!;
    const time = booking.time!.length === 5 ? booking.time! : booking.time!.slice(0, 5);
    const startDateTime = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startDateTime.getTime())) {
      return { ok: false, message: "That date or time didn't look valid — could you repeat it?" };
    }

    const endDateTime = new Date(startDateTime.getTime() + service.duration * 60_000);
    const endTime = `${String(endDateTime.getHours()).padStart(2, "0")}:${String(endDateTime.getMinutes()).padStart(2, "0")}`;
    const appointmentId = cryptoRandomId();
    const now = new Date().toISOString();
    const defaultBarber = await db.get<{ id: string }>("SELECT id FROM users WHERE role IN ('barber', 'owner') LIMIT 1");

    await db.run(
      `INSERT INTO appointments (id, client_id, program, start_time, end_time, location, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      appointmentId,
      client.id,
      "BARBERSHOP",
      `${date}T${time}:00`,
      `${date}T${endTime}:00`,
      "IFCDC Barbershop",
      `[${service.name}] AURA phone booking${booking.notes ? " — " + booking.notes : ""}`,
      defaultBarber?.id || "aura-receptionist",
      now
    );

    const formattedDate = startDateTime.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    return {
      ok: true,
      message: `You're booked for a ${service.name} on ${formattedDate} at ${time}. We'll confirm by text shortly.`,
    };
  } catch (err) {
    console.error("AURA barbershop booking error:", err);
    return { ok: false, message: "I couldn't complete the booking just now — I'll have our team call you back." };
  }
}

export async function createReceptionistFollowUp(
  phone: string | null | undefined,
  reason: string,
  channel: "voice" | "sms"
): Promise<void> {
  if (!phone) return;
  try {
    const db = getMonolithDb();
    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE phone = ? LIMIT 1", phone);
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO outreach_tasks (id, client_id, phone, channel, reason, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      cryptoRandomId(),
      client?.id ?? null,
      phone,
      channel.toUpperCase(),
      `AURA: ${reason.slice(0, 200)}`,
      "OPEN",
      now,
      null
    );
  } catch (err) {
    console.error("AURA follow-up task error:", err);
  }
}
