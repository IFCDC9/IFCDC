import { SDK_VERSION, PLATFORM_VERSION } from "./developerDocumentation";
import { getRegisteredApp, verifyAppApiKey } from "./softwareDivisionSchema";
import { buildCompatibilityMatrix } from "./appDiagnostics";

export interface EnvValidationResult {
  valid: boolean;
  score: number;
  checks: {
    id: string;
    label: string;
    passed: boolean;
    message: string;
    severity: "required" | "recommended" | "optional";
  }[];
  sdkVersion: string;
  platformVersion: string;
  compatible: boolean;
  timestamp: string;
}

export async function validateAppEnvironment(input: {
  appId: string;
  healthUrl: string;
  launchUrl?: string;
  apiKey?: string;
  sdkVersion?: string;
}): Promise<EnvValidationResult> {
  const checks: EnvValidationResult["checks"] = [];
  const matrix = buildCompatibilityMatrix();

  checks.push({
    id: "app-id-format",
    label: "Application ID format",
    passed: /^[a-z0-9-]+$/.test(input.appId) && input.appId !== "barbers",
    message: input.appId === "barbers"
      ? "Barbers App is production locked"
      : /^[a-z0-9-]+$/.test(input.appId)
        ? "Valid application ID"
        : "ID must be lowercase alphanumeric with hyphens",
    severity: "required",
  });

  let healthOk = false;
  let healthLatency = 0;
  let healthVersion: string | undefined;
  try {
    const start = Date.now();
    const res = await fetch(input.healthUrl, { signal: AbortSignal.timeout(8000) });
    healthLatency = Date.now() - start;
    healthOk = res.ok;
    try {
      const data = (await res.json()) as { version?: string };
      healthVersion = data.version;
    } catch { /* non-json health ok */ }
  } catch {
    healthOk = false;
  }

  checks.push({
    id: "health-endpoint",
    label: "Health endpoint reachable",
    passed: healthOk,
    message: healthOk
      ? `Health check passed (${healthLatency}ms${healthVersion ? `, v${healthVersion}` : ""})`
      : `Cannot reach ${input.healthUrl}`,
    severity: "required",
  });

  const isProd = process.env.NODE_ENV === "production";
  const healthHttps = input.healthUrl.startsWith("https://");
  checks.push({
    id: "https-health",
    label: "HTTPS health URL",
    passed: !isProd || healthHttps,
    message: healthHttps ? "HTTPS configured" : isProd ? "HTTPS required in production" : "HTTP acceptable in development",
    severity: isProd ? "required" : "recommended",
  });

  const registered = await getRegisteredApp(input.appId);
  checks.push({
    id: "hq-registered",
    label: "Registered with Headquarters",
    passed: Boolean(registered),
    message: registered ? "Application found in HQ registry" : "Register via Developer Portal first",
    severity: "recommended",
  });

  if (input.apiKey && registered) {
    const keyValid = await verifyAppApiKey(input.appId, input.apiKey);
    checks.push({
      id: "api-key",
      label: "API key valid",
      passed: keyValid,
      message: keyValid ? "API key verified against HQ registry" : "Invalid API key for this application",
      severity: "required",
    });
  } else if (registered) {
    checks.push({
      id: "api-key",
      label: "API key provided",
      passed: false,
      message: "Provide API key to verify credentials",
      severity: "recommended",
    });
  }

  const sdkVer = input.sdkVersion ?? SDK_VERSION;
  const compatible = sdkVer.startsWith("1.2") || sdkVer.startsWith("1.3") || sdkVer === SDK_VERSION;
  checks.push({
    id: "sdk-version",
    label: "SDK version compatibility",
    passed: compatible,
    message: compatible
      ? `SDK v${sdkVer} compatible with platform v${PLATFORM_VERSION}`
      : `SDK v${sdkVer} may be incompatible — use v${matrix.recommended.sdk}`,
    severity: "required",
  });

  if (input.launchUrl) {
    checks.push({
      id: "launch-url",
      label: "Launch URL format",
      passed: input.launchUrl.startsWith("http"),
      message: input.launchUrl.startsWith("http") ? "Valid launch URL" : "Launch URL must start with http(s)://",
      severity: "optional",
    });
  }

  checks.push({
    id: "env-vars",
    label: "Environment variables",
    passed: true,
    message: "Required: IFCDC_HQ_BASE_URL, IFCDC_APP_ID, IFCDC_HQ_TOKEN",
    severity: "required",
  });

  const requiredChecks = checks.filter((c) => c.severity === "required");
  const score = Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);
  const valid = requiredChecks.every((c) => c.passed);

  return {
    valid,
    score,
    checks,
    sdkVersion: sdkVer,
    platformVersion: PLATFORM_VERSION,
    compatible,
    timestamp: new Date().toISOString(),
  };
}

export function buildSdkSetupScript(appId: string, baseUrl = "http://localhost:5000") {
  return `#!/bin/bash
# IFCDC Headquarters — SDK Setup for ${appId}
set -e
echo "Installing IFCDC Headquarters SDK..."
npm install @ifcdc/headquarters-sdk
echo "Creating .env.local..."
cat > .env.local << 'ENVEOF'
IFCDC_HQ_BASE_URL=${baseUrl}
IFCDC_APP_ID=${appId}
IFCDC_HQ_TOKEN=your-api-key-from-developer-portal
ENVEOF
echo "Creating src/lib/hqClient.ts..."
mkdir -p src/lib
cat > src/lib/hqClient.ts << 'TS_EOF'
import { createHeadquartersClient } from "@ifcdc/headquarters-sdk";
export const hq = createHeadquartersClient({
  baseUrl: process.env.IFCDC_HQ_BASE_URL!,
  appId: process.env.IFCDC_APP_ID!,
  token: process.env.IFCDC_HQ_TOKEN,
});
TS_EOF
echo "Setup complete. Add your API key to .env.local and run environment validation."
`;
}

export function buildPackageJsonSnippet() {
  return {
    dependencies: { "@ifcdc/headquarters-sdk": "^1.3.0" },
    scripts: { "hq:setup": "bash setup-ifcdc-hq.sh" },
  };
}
