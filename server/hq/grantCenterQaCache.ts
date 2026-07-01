export type GrantQaCheck = {
  status: "pass" | "fail";
  message: string;
  detail?: string;
};

export type GrantCenterQaReport = {
  status: "pending" | "running" | "pass" | "fail" | "env_missing" | "error";
  pass: number;
  fail: number;
  checks: GrantQaCheck[];
  qaTag?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  target: string;
};

let cache: GrantCenterQaReport = {
  status: "pending",
  pass: 0,
  fail: 0,
  checks: [],
  target: "localhost",
};

export function getGrantCenterQaReport(): GrantCenterQaReport {
  return { ...cache, checks: [...cache.checks] };
}

export function setGrantCenterQaReport(report: GrantCenterQaReport): void {
  cache = report;
}

export function grantCenterQaEnvReady(): { ready: boolean; missing: string[]; service: string } {
  const missing: string[] = [];
  if (!(process.env.FOUNDER_SEED_PASSWORD || "").trim()) missing.push("FOUNDER_SEED_PASSWORD");
  if (!(process.env.MASTER_OWNER_EMAIL || "").trim()) missing.push("MASTER_OWNER_EMAIL");
  if (!(process.env.JWT_SECRET || process.env.SESSION_SECRET || "").trim()) missing.push("JWT_SECRET");
  return { ready: missing.length === 0, missing, service: "ifcdc-hq" };
}
