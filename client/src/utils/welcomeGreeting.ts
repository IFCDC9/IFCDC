import type { UserInfo } from "../auth/AuthContext";

const HONORIFIC_PATTERN = /^(mr|mrs|ms|miss|dr|prof|rev)\.?$/i;

function isHonorific(part: string): boolean {
  return HONORIFIC_PATTERN.test(part.replace(/\.$/, ""));
}

function normalizeHonorific(part: string): string {
  const base = part.replace(/\.$/, "");
  return `${base.charAt(0).toUpperCase()}${base.slice(1).toLowerCase()}.`;
}

function extractHonorificFromName(name: string): string | null {
  const first = name.split(/\s+/).filter(Boolean)[0];
  if (!first || !isHonorific(first)) return null;
  return normalizeHonorific(first);
}

/**
 * Builds the Founder Dashboard welcome line, e.g. "Mr. Allah".
 * Prefers honorific + last name; falls back to first name or full display name.
 */
export function formatWelcomeGreeting(user: UserInfo | null): string {
  if (user?.welcomeGreeting?.trim()) return user.welcomeGreeting.trim();
  if (!user) return "Founder";

  const name = (user.name ?? "").trim();
  const employeeLast = user.employee?.lastName?.trim();
  const employeeFirst = user.employee?.firstName?.trim();

  if (employeeLast) {
    const honorific = extractHonorificFromName(name) ?? "Mr.";
    return `${honorific} ${employeeLast}`;
  }

  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const honorific = parts.length > 0 && isHonorific(parts[0]) ? normalizeHonorific(parts[0]) : null;
    const remaining = honorific ? parts.slice(1) : parts;

    if (remaining.length >= 1) {
      const lastName = remaining[remaining.length - 1];
      if (honorific) return `${honorific} ${lastName}`;
      if (remaining.length === 1) return remaining[0];
      return remaining[0];
    }
  }

  if (employeeFirst) return employeeFirst;
  if (name) return name;
  return "Founder";
}

/** Full executive date line for the Founder hero subtitle */
export function formatExecutiveDateLine(date = new Date()): string {
  const formatted = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${formatted} · Imperial Foundation Community Development Corporation`;
}

/** Short personalized tagline beneath the welcome heading */
export function formatExecutiveTagline(user: UserInfo | null): string {
  const role = user?.enterpriseRoleLabel ?? "Founder";
  const hour = new Date().getHours();
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${period}, ${role}. Your enterprise command center is live.`;
}
