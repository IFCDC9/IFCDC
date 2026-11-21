/**
 * Localhost :4100–4104 sidecars are workstation services.
 * They are not deployed on Render HQ and are not the Headquarters SQLite
 * database (ifcdc.db / IFCDC_DATA_DIR), Founder cookie/JWT session, or
 * Postmark / inline email path.
 */
export const IFCDC_SIDECAR_PORTS = new Set([4100, 4101, 4102, 4103, 4104]);

export const SIDECAR_NOT_PRODUCTION_DETAIL =
  "localhost sidecars on ports 4100–4104 are not deployed. They are not the Headquarters database, Founder session, or Postmark path.";

export type IfcdcSidecarClassification = "ok" | "down" | "not_deployed" | "not_applicable";

export type IfcdcServiceProbe = {
  name: string;
  url: string;
  probed: boolean;
  ok: boolean;
  status: IfcdcSidecarClassification;
  detail: string;
};

export type SidecarEnv = NodeJS.Dict<string | undefined>;

export function isHqProductionSidecarRuntime(env: SidecarEnv = process.env): boolean {
  const render = env.RENDER === "true" || Boolean((env.RENDER_SERVICE_ID || "").trim());
  const production = env.NODE_ENV === "production" && env.ALLOW_DEMO_SEED !== "true";
  return Boolean(render || production);
}

export function isLocalIfcdcSidecarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    return IFCDC_SIDECAR_PORTS.has(port);
  } catch {
    return false;
  }
}

/** Workstation/dev still probes localhost :4100–4104. Production/Render does not. */
export function shouldProbeIfcdcSidecarUrl(url: string, env: SidecarEnv = process.env): boolean {
  if (!isLocalIfcdcSidecarUrl(url)) return true;
  return !isHqProductionSidecarRuntime(env);
}

export function classifyIfcdcServiceProbe(input: {
  name: string;
  url: string;
  ok: boolean | null;
  probed: boolean;
  skipReason?: "legacy_4101" | "production_localhost_sidecar" | null;
  env?: SidecarEnv;
}): IfcdcServiceProbe {
  const env = input.env ?? process.env;
  const production = isHqProductionSidecarRuntime(env);
  const localSidecar = isLocalIfcdcSidecarUrl(input.url);
  const base = {
    name: input.name,
    url: input.url,
    probed: input.probed,
    ok: Boolean(input.ok),
  };

  if (input.skipReason === "legacy_4101") {
    return {
      ...base,
      probed: false,
      ok: false,
      status: "not_applicable",
      detail: `not_applicable. Phase 7: legacy :4101 is not required for HQ production AURA. ${SIDECAR_NOT_PRODUCTION_DETAIL}`,
    };
  }

  if (input.skipReason === "production_localhost_sidecar" || (!input.probed && localSidecar && production)) {
    return {
      ...base,
      probed: false,
      ok: false,
      status: "not_deployed",
      detail: `not_deployed. ${SIDECAR_NOT_PRODUCTION_DETAIL}`,
    };
  }

  if (input.ok === true) {
    return {
      ...base,
      probed: true,
      ok: true,
      status: "ok",
      detail: "Live sidecar health check succeeded.",
    };
  }

  if (input.probed && input.ok === false) {
    if (localSidecar && production) {
      return {
        ...base,
        ok: false,
        status: "not_deployed",
        detail: `not_deployed. ${SIDECAR_NOT_PRODUCTION_DETAIL}`,
      };
    }
    return {
      ...base,
      ok: false,
      status: "down",
      detail: "Live sidecar health check did not succeed.",
    };
  }

  if (localSidecar && production) {
    return {
      ...base,
      probed: false,
      ok: false,
      status: "not_deployed",
      detail: `not_deployed. ${SIDECAR_NOT_PRODUCTION_DETAIL}`,
    };
  }

  return {
    ...base,
    ok: false,
    status: "not_applicable",
    detail: `not_applicable. Probe did not run. ${SIDECAR_NOT_PRODUCTION_DETAIL}`,
  };
}

export function productionSidecarTimeoutProbes(
  urls: Record<string, string>,
  env: SidecarEnv = process.env
): IfcdcServiceProbe[] {
  return Object.entries(urls).map(([name, url]) =>
    classifyIfcdcServiceProbe({
      name,
      url,
      ok: null,
      probed: false,
      skipReason: isLocalIfcdcSidecarUrl(url) && isHqProductionSidecarRuntime(env)
        ? name === "aura"
          ? "legacy_4101"
          : "production_localhost_sidecar"
        : name === "aura"
          ? "legacy_4101"
          : null,
      env,
    })
  );
}

/** Only live ok/down probes count toward platform health. */
export function countedPlatformServiceTotals(probes: IfcdcServiceProbe[]): {
  healthy: number;
  total: number;
  notDeployed: number;
} {
  const counted = probes.filter((p) => p.status === "ok" || p.status === "down");
  return {
    healthy: counted.filter((p) => p.status === "ok").length,
    total: counted.length,
    notDeployed: probes.filter((p) => p.status === "not_deployed" || p.status === "not_applicable").length,
  };
}

/**
 * A command-health services timeout is an HQ outage only when a remote
 * (non localhost :4100–4104) URL was expected. Production localhost sidecars
 * timing out is not an HQ outage.
 */
export function servicesTimeoutIsHqOutage(input: {
  timedOut: boolean;
  urls: Record<string, string>;
  env?: SidecarEnv;
}): boolean {
  if (!input.timedOut) return false;
  const env = input.env ?? process.env;
  const remotes = Object.values(input.urls).filter((url) => !isLocalIfcdcSidecarUrl(url));
  if (remotes.length) return true;
  if (isHqProductionSidecarRuntime(env)) return false;
  return true;
}

export function brainStatusFromSidecarProbe(probe: IfcdcServiceProbe): {
  status: "healthy" | "action_required" | "not deployed" | "unknown";
  detail: string;
} {
  if (probe.status === "ok") return { status: "healthy", detail: probe.detail };
  if (probe.status === "not_deployed" || probe.status === "not_applicable") {
    return { status: "not deployed", detail: probe.detail };
  }
  if (probe.status === "down") return { status: "action_required", detail: probe.detail };
  return { status: "unknown", detail: probe.detail };
}

export function systemsRequireActionFromSidecarProbes(probes: IfcdcServiceProbe[]): IfcdcServiceProbe[] {
  return probes.filter((p) => p.status === "down");
}

export type SidecarTechFinding = {
  id: string;
  module: "platform";
  title: string;
  status: "ok" | "warning" | "degraded" | "failed" | "unknown";
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  recommendedFix?: string;
};

export function techFindingsFromSidecarProbes(probes: IfcdcServiceProbe[]): SidecarTechFinding[] {
  const down = probes.filter((p) => p.status === "down");
  if (down.length) {
    return [
      {
        id: "microservices-down",
        module: "platform",
        title: "IFCDC microservices unreachable",
        status: "degraded",
        severity: "medium",
        detail: `Down/unreachable: ${down.map((p) => p.name).join(", ")}`,
        recommendedFix: "Remote IFCDC_SERVICE_* URLs did not respond. Localhost :4100–4104 are not production HQ.",
      },
    ];
  }
  const skipped = probes.filter((p) => p.status === "not_deployed" || p.status === "not_applicable");
  if (skipped.length && skipped.length === probes.length) {
    return [
      {
        id: "microservices-not-deployed",
        module: "platform",
        title: "Localhost sidecars not deployed on production HQ",
        status: "ok",
        severity: "low",
        detail: SIDECAR_NOT_PRODUCTION_DETAIL,
      },
    ];
  }
  if (probes.some((p) => p.status === "ok")) {
    return [
      {
        id: "microservices-ok",
        module: "platform",
        title: "Platform microservices",
        status: "ok",
        severity: "low",
        detail: `${probes.filter((p) => p.status === "ok").length} live sidecar probe(s) succeeded`,
      },
    ];
  }
  return [];
}

/** Founder session is HQ JWT, not :4100. */
export function integrationsHubAuthFromJwt(jwtConfigured: boolean): {
  healthy: boolean;
  displayStatus: "Connected" | "Disconnected";
  message: string;
} {
  return {
    healthy: jwtConfigured,
    displayStatus: jwtConfigured ? "Connected" : "Disconnected",
    message: jwtConfigured
      ? "Founder session secrets ready. localhost :4100 auth sidecar is not the Founder session."
      : "JWT/SESSION secret missing. Not the :4100 auth sidecar.",
  };
}

/** Postmark / Resend / inline email is not :4102. */
export function integrationsHubEmailFromInline(emailConfigured: boolean): {
  healthy: boolean;
  displayStatus: "Connected" | "Warning";
  message: string;
} {
  return {
    healthy: emailConfigured,
    displayStatus: emailConfigured ? "Connected" : "Warning",
    message: emailConfigured
      ? "Inline / Postmark-Resend email path configured. localhost :4102 is not the email path."
      : "Outbound email credentials not configured. Not the :4102 notifications sidecar.",
  };
}
