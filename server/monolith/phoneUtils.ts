export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits || null;
}

export function normalizeChannel(value: string | null | undefined): string {
  if (!value) return "SMS";
  const v = value.toString().toUpperCase();
  if (["SMS", "VOICE", "BOTH", "NONE"].includes(v)) return v;
  return "SMS";
}

export function isSmsAllowedForChannel(channel: string | null | undefined): boolean {
  const v = normalizeChannel(channel);
  return v === "SMS" || v === "BOTH";
}

export function isVoiceAllowedForChannel(channel: string | null | undefined): boolean {
  const v = normalizeChannel(channel);
  return v === "VOICE" || v === "BOTH";
}

export function buildSafeAppointmentReminderText(_client: { fullName?: string }, appointment: { start_time?: string; startTime?: string }): string {
  const when = new Date(appointment.start_time || appointment.startTime || "");
  const dateStr = when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeStr = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    `Reminder from IFCDC: You have an upcoming appointment on ${dateStr} at ${timeStr}. ` +
    `If you need to cancel or reschedule, please call us.`
  );
}
