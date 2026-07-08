/**
 * Founder trusted-device helpers for HQ web.
 * Uses WebAuthn (Face ID / Touch ID) when the platform supports it;
 * otherwise registers a durable browser device id for seamless Founder Mode.
 */

const DEVICE_KEY = "ifcdc_aura_founder_device_id";
const BIOMETRIC_FLAG = "ifcdc_aura_founder_biometric";

function randomDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `hq-${crypto.randomUUID()}`;
  }
  return `hq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getOrCreateFounderDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 16) return existing;
    const id = randomDeviceId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return randomDeviceId();
  }
}

export function getFounderDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function supportsPlatformBiometric(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator.credentials?.create === "function";
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!supportsPlatformBiometric()) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Attempt Face ID / Touch ID (platform authenticator) when supported.
 * Cancellation does not block trusted-device registration — HQ password
 * session already proved Founder identity for this browser.
 */
export async function gateFounderBiometric(deviceId: string): Promise<{
  ok: boolean;
  biometricBound: boolean;
  skipped: boolean;
}> {
  if (!(await platformAuthenticatorAvailable())) {
    return { ok: true, biometricBound: false, skipped: true };
  }

  // Already bound this browser — skip re-prompt for daily use.
  if (wasBiometricBoundLocally()) {
    return { ok: true, biometricBound: true, skipped: true };
  }

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new TextEncoder().encode(deviceId.slice(0, 64));

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "IFCDC Headquarters", id: window.location.hostname },
        user: {
          id: userId,
          name: "founder@ifcdc.org",
          displayName: "IFCDC Founder",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60_000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!cred) return { ok: false, biometricBound: false, skipped: false };

    try {
      localStorage.setItem(BIOMETRIC_FLAG, "1");
    } catch {
      /* ignore */
    }
    return { ok: true, biometricBound: true, skipped: false };
  } catch {
    return { ok: false, biometricBound: false, skipped: false };
  }
}

export function wasBiometricBoundLocally(): boolean {
  try {
    return localStorage.getItem(BIOMETRIC_FLAG) === "1";
  } catch {
    return false;
  }
}
