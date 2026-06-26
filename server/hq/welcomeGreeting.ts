/** Server-side welcome greeting — single source of truth for Founder Dashboard */

export interface WelcomeProfile {
  name?: string;
  email?: string;
  employee?: { firstName?: string; lastName?: string } | null;
}

const HONORIFIC_PATTERN = /^(mr|mrs|ms|miss|dr|prof|rev)\.?$/i;

function isHonorific(part: string): boolean {
  return HONORIFIC_PATTERN.test(part.replace(/\.$/, ""));
}

function normalizeHonorific(part: string): string {
  const base = part.replace(/\.$/, "");
  return `${base.charAt(0).toUpperCase()}${base.slice(1).toLowerCase()}.`;
}

export function buildWelcomeGreeting(profile: WelcomeProfile | null): string {
  if (!profile) return "Founder";

  const name = (profile.name ?? "").trim();
  const employeeLast = profile.employee?.lastName?.trim();
  const employeeFirst = profile.employee?.firstName?.trim();

  if (employeeLast) {
    const honorific = extractHonorific(name) ?? defaultHonorific(profile);
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

    if (honorific && parts.length === 1) {
      return honorific;
    }
  }

  if (employeeFirst) return employeeFirst;
  if (name && !isHonorific(name)) return name;
  return "Founder";
}

function extractHonorific(name: string): string | null {
  const first = name.split(/\s+/).filter(Boolean)[0];
  if (!first || !isHonorific(first)) return null;
  return normalizeHonorific(first);
}

function defaultHonorific(profile: WelcomeProfile): string {
  const email = (profile.email ?? "").toLowerCase();
  if (email === "service@ifcdc.org") return "Mr.";
  return "Mr.";
}
