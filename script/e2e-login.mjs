#!/usr/bin/env node
/** Quick smoke test: login API + session + HQ page + critical Vite modules */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* optional */
  }
}

loadEnv();

const EMAIL = "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const modules = [
  "main.jsx",
  "App.tsx",
  "pages/LoginPage.jsx",
  "pages/hq/ExecutiveDashboard.tsx",
  "components/hq/ExecutiveWidgetDashboard.tsx",
  "layouts/HQLayout.tsx",
];

async function checkModule(path) {
  const res = await fetch(`${BASE}/src/${path}`);
  const text = await res.text();
  const err = text.match(/Internal server error|already been declared|Failed to resolve|Unexpected token/);
  return { path, status: res.status, ok: res.ok && !err, err: err?.[0] };
}

async function main() {
  console.log("IFCDC E2E smoke test\n");

  const modResults = await Promise.all(modules.map(checkModule));
  for (const r of modResults) {
    console.log(r.ok ? "✓" : "✗", `${r.status} /src/${r.path}`, r.err ?? "");
  }
  if (modResults.some((r) => !r.ok)) process.exitCode = 1;

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginBody = await loginRes.json();
  const cookie = loginRes.headers.getSetCookie?.()?.join("; ") ?? "";
  console.log(loginRes.ok ? "✓" : "✗", "POST /api/auth/login", loginBody.role ?? loginBody.error ?? loginRes.status);

  const sessionRes = await fetch(`${BASE}/api/hq/auth/session`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const session = await sessionRes.json();
  console.log(
    sessionRes.ok && session.user ? "✓" : "✗",
    "GET /api/hq/auth/session",
    session.user?.enterpriseRoleLabel ?? session.error ?? sessionRes.status
  );

  const hqRes = await fetch(`${BASE}/hq`, { headers: cookie ? { Cookie: cookie } : {} });
  const hqHtml = await hqRes.text();
  const hasRoot = hqHtml.includes('id="root"');
  const hasMain = hqHtml.includes("/src/main.jsx");
  console.log(hqRes.ok && hasRoot && hasMain ? "✓" : "✗", "GET /hq shell", hqRes.status);

  const execRes = await fetch(`${BASE}/src/pages/hq/ExecutiveDashboard.tsx`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  console.log(execRes.ok ? "✓" : "✗", "GET ExecutiveDashboard module", execRes.status);

  if (!loginRes.ok || !sessionRes.ok || !session.user) process.exitCode = 1;
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
