export const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "DEV_ONLY_CHANGE_ME_IFCDC";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
export const COOKIE_NAME = "ifcdc_token";
