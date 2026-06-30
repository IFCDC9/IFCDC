import { ROLES } from "./constants";
import { getMonolithDb } from "./dbAccess";

export async function hasClientAccess(
  user: { id?: string; role?: string } | undefined,
  clientId: string,
): Promise<boolean> {
  if (!user?.id || !user?.role) return false;
  if (user.role === "owner" || user.role === ROLES.EXEC) return true;
  const db = getMonolithDb();
  const assignment = await db.get(
    "SELECT 1 FROM client_assignments WHERE client_id = ? AND user_id = ?",
    clientId,
    user.id,
  );
  return !!assignment;
}
