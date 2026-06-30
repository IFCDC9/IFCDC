import * as client from "openid-client";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

let googleOAuthConfig: Awaited<ReturnType<typeof client.discovery>> | null = null;

export async function initGoogleOAuth(): Promise<void> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.log("Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)");
    return;
  }

  try {
    googleOAuthConfig = await client.discovery(
      new URL("https://accounts.google.com/.well-known/openid-configuration"),
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
    );
    console.log("Google OAuth configured successfully");
  } catch (err) {
    console.error("Failed to initialize Google OAuth:", err);
  }
}

export function getGoogleOAuthConfig() {
  return googleOAuthConfig;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(googleOAuthConfig && GOOGLE_CLIENT_ID);
}
