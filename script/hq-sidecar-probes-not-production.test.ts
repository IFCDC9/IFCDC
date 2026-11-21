import assert from "node:assert/strict";
import test from "node:test";
import { scoreFromFindings } from "../server/hq/auraTechnicalCommandEngine";
import {
  brainStatusFromSidecarProbe,
  classifyIfcdcServiceProbe,
  countedPlatformServiceTotals,
  integrationsHubAuthFromJwt,
  integrationsHubEmailFromInline,
  isHqProductionSidecarRuntime,
  productionSidecarTimeoutProbes,
  servicesTimeoutIsHqOutage,
  shouldProbeIfcdcSidecarUrl,
  systemsRequireActionFromSidecarProbes,
  techFindingsFromSidecarProbes,
  type IfcdcServiceProbe,
} from "../server/lib/ifcdcSidecarProbes";

const productionEnv = {
  NODE_ENV: "production",
  RENDER: "true",
  RENDER_SERVICE_ID: "srv-hq",
};

const workstationEnv = {
  NODE_ENV: "development",
};

const sidecarUrls = {
  auth: "http://localhost:4100",
  aura: "http://localhost:4101",
  notifications: "http://localhost:4102",
  payments: "http://localhost:4103",
  database: "http://localhost:4104",
};

function productionTimeoutProbes(): IfcdcServiceProbe[] {
  return Object.entries(sidecarUrls).map(([name, url]) =>
    classifyIfcdcServiceProbe({
      name,
      url,
      ok: null,
      probed: false,
      skipReason: name === "aura" ? "legacy_4101" : "production_localhost_sidecar",
      env: productionEnv,
    })
  );
}

test("production/Render does not probe localhost :4100–4104", () => {
  for (const url of Object.values(sidecarUrls)) {
    assert.equal(shouldProbeIfcdcSidecarUrl(url, productionEnv), false);
  }
  assert.equal(shouldProbeIfcdcSidecarUrl("http://localhost:4100", workstationEnv), true);
  assert.equal(shouldProbeIfcdcSidecarUrl("https://auth.example.com", productionEnv), true);
  assert.equal(isHqProductionSidecarRuntime(productionEnv), true);
});

test("production/Render classification does not add action_required for sidecar timeouts", () => {
  const probes = productionTimeoutProbes();
  assert.equal(probes.length, 5);
  for (const probe of probes) {
    assert.ok(probe.status === "not_deployed" || probe.status === "not_applicable");
    assert.equal(probe.probed, false);
    assert.match(probe.detail, /not the Headquarters database/);
    assert.equal(probe.detail.includes("SELECT 1"), false);
    assert.equal(probe.detail.includes("ifcdc.db"), false);
    const row = brainStatusFromSidecarProbe(probe);
    assert.equal(row.status, "not deployed");
    assert.notEqual(row.status, "action_required");
  }
  assert.deepEqual(systemsRequireActionFromSidecarProbes(probes), []);
});

test("production sidecar timeouts are not command-health or Technical Command outages", () => {
  const probes = productionTimeoutProbes();
  const counts = countedPlatformServiceTotals(probes);
  assert.equal(counts.total, 0);
  assert.equal(counts.healthy, 0);
  assert.equal(counts.notDeployed, 5);

  assert.equal(
    servicesTimeoutIsHqOutage({ timedOut: true, urls: sidecarUrls, env: productionEnv }),
    false
  );
  assert.equal(
    servicesTimeoutIsHqOutage({
      timedOut: true,
      urls: { ...sidecarUrls, auth: "https://auth.example.com" },
      env: productionEnv,
    }),
    true
  );

  const findings = techFindingsFromSidecarProbes(probes);
  assert.equal(findings.some((f) => f.status === "degraded" || f.status === "failed"), false);
  assert.equal(findings.some((f) => f.id === "microservices-down"), false);
  const scored = scoreFromFindings(findings);
  assert.notEqual(scored.label, "critical");
  assert.notEqual(scored.label, "degraded");
  assert.ok(scored.score >= 85);
});

test("workstation still treats a probed localhost miss as down", () => {
  const miss = classifyIfcdcServiceProbe({
    name: "auth",
    url: "http://localhost:4100",
    ok: false,
    probed: true,
    env: workstationEnv,
  });
  assert.equal(miss.status, "down");
  assert.equal(brainStatusFromSidecarProbe(miss).status, "action_required");
});

test("Integrations Hub auth and email are not :4100/:4102 sidecars", () => {
  const auth = integrationsHubAuthFromJwt(true);
  assert.equal(auth.healthy, true);
  assert.match(auth.message, /not the Founder session/);
  const email = integrationsHubEmailFromInline(true);
  assert.equal(email.healthy, true);
  assert.match(email.message, /not the email path/);
  const emptyAuth = integrationsHubAuthFromJwt(false);
  assert.equal(emptyAuth.healthy, false);
});

test("productionSidecarTimeoutProbes matches Founder policy text", () => {
  const probes = productionSidecarTimeoutProbes(sidecarUrls, productionEnv);
  assert.equal(probes.every((p) => p.status === "not_deployed" || p.status === "not_applicable"), true);
  assert.match(probes[0]!.detail, /Postmark path/);
});
