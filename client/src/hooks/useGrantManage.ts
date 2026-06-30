import { useAuth } from "../auth/AuthContext";

/** True when the user may create, edit, or delete grant records (matches server mutation guard). */
export function useGrantManage() {
  const { user, hasPermission } = useAuth();
  const canManage =
    user?.role === "owner" ||
    user?.enterpriseRole === "founder" ||
    hasPermission("hq.grants.manage");
  return { canManage, isReadOnly: !canManage };
}
