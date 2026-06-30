import type { Request } from "express";
import { getMonolithDb } from "./dbAccess";
import { cryptoRandomId } from "./constants";

export interface AuditLogParams {
  adminId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  extra?: Record<string, unknown>;
}

export async function logAudit(req: Request, params: AuditLogParams): Promise<void> {
  const db = getMonolithDb();
  const id = cryptoRandomId();
  const timestamp = new Date().toISOString();
  const ipAddress =
    params.ip ||
    req?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null;

  await db.run(
    `INSERT INTO audit_logs (id, timestamp, user_id, user_role, method, path, entity_type, entity_id, action, ip_address, extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    timestamp,
    params.adminId || req?.user?.id || null,
    req?.user?.role || null,
    req?.method ?? null,
    req?.originalUrl ?? null,
    params.targetType || null,
    params.targetId || null,
    params.action,
    ipAddress,
    JSON.stringify(params.extra || {}),
  );
}
