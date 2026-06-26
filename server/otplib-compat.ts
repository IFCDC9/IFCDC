import { generateSecret, generateURI, verifySync } from "otplib";

/** Compatibility wrapper for otplib v13+ (replaces deprecated authenticator API) */
export const authenticator = {
  generateSecret(): string {
    return generateSecret();
  },

  keyuri(email: string, issuer: string, secret: string): string {
    return generateURI({ strategy: "totp", issuer, label: email, secret });
  },

  verify({ token, secret }: { token: string; secret: string }): boolean {
    return verifySync({ strategy: "totp", token, secret }).valid;
  },
};
