#!/usr/bin/env node
/**
 * Mission Control CRUD smoke test (local or production).
 * Usage:
 *   IFCDC_BASE_URL=http://localhost:5000 \
 *   IFCDC_SUPER_ADMIN_EMAIL=service@ifcdc.org \
 *   IFCDC_SUPER_ADMIN_PASSWORD=*** \
 *   node script/mission-control-verify.mjs
 */
const BASE = process.env.IFCDC_BASE_URL || "http://localhost:5000";
const EMAIL = process.env.IFCDC_SUPER_ADMIN_EMAIL || process.env.MASTER_OWNER_EMAIL;
const PASSWORD = process.env.IFCDC_SUPER_ADMIN_PASSWORD || process.env.FOUNDER_SEED_PASSWORD;

let fail = 0;
const log = (ok, msg, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

async function login() {
  if (!EMAIL || !PASSWORD) {
    console.error("Set IFCDC_SUPER_ADMIN_EMAIL and IFCDC_SUPER_ADMIN_PASSWORD.");
    process.exit(1);
  }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  if (!res.ok || !cookie) throw new Error(`Login failed (${res.status})`);
  return cookie;
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function main() {
  console.log(`\nMission Control Verify — ${BASE}\n`);
  const cookie = await login();
  log(true, "Login", EMAIL);

  const mc = await api(cookie, "GET", "/api/hq/phase10/mission-control");
  log(mc.res.ok && mc.data.executiveDashboard, "GET mission-control aggregate", `${mc.res.status}`);
  log(Array.isArray(mc.data.missionOperations?.missions), "Mission operations section");
  log(Array.isArray(mc.data.auditHistory?.entries), "Audit history section");

  const created = await api(cookie, "POST", "/api/hq/phase10/missions", {
    title: `Verify mission ${Date.now()}`,
    status: "planning",
    priority: "high",
  });
  const missionId = created.data.mission?.id;
  log(created.res.status === 201 && !!missionId, "POST mission", missionId ?? "");

  if (missionId) {
    const patched = await api(cookie, "PATCH", `/api/hq/phase10/missions/${missionId}`, { status: "active" });
    log(patched.res.ok && patched.data.mission?.status === "active", "PATCH mission status");

    const task = await api(cookie, "POST", "/api/hq/phase10/mission-tasks", {
      title: "Verify task",
      missionId,
      priority: "medium",
    });
    const taskId = task.data.task?.id;
    log(task.res.status === 201 && !!taskId, "POST mission task");

    if (taskId) {
      const approved = await api(cookie, "POST", `/api/hq/phase10/mission-tasks/${taskId}/approve`);
      log(approved.res.ok && approved.data.task?.status === "approved", "POST approve task");

      const hist = await api(cookie, "GET", `/api/hq/phase10/mission-tasks/${taskId}/history`);
      log(hist.res.ok && Array.isArray(hist.data.history) && hist.data.history.length > 0, "GET task history");
    }

    await api(cookie, "DELETE", `/api/hq/phase10/missions/${missionId}`);
  }

  const obj = await api(cookie, "POST", "/api/hq/phase10/objectives", {
    title: `Verify objective ${Date.now()}`,
    objectiveType: "quarterly",
    targetValue: 100,
  });
  const objId = obj.data.objective?.id;
  log(obj.res.status === 201 && !!objId, "POST objective");
  if (objId) {
    await api(cookie, "DELETE", `/api/hq/phase10/objectives/${objId}`);
  }

  const audit = await api(cookie, "GET", "/api/hq/phase10/audit?limit=5");
  log(audit.res.ok && Array.isArray(audit.data.entries), "GET audit");

  console.log(`\nResult: ${fail === 0 ? "MISSION CONTROL OK" : `${fail} FAILED`}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
