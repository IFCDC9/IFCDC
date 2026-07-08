import { useAuth } from "../auth/AuthContext";

/** True when the user may create, edit, or delete grant records (matches server mutation guard). */
export function useGrantManage() {
  const { user, hasPermission } = useAuth();
  const role = (user?.role || "").toLowerCase();
  const canManage =
    role === "owner" ||
    role === "founder" ||
    role === "exec" ||
    role === "admin" ||
    user?.enterpriseRole === "founder" ||
    user?.email?.toLowerCase() === "service@ifcdc.org" ||
    hasPermission("hq.grants.manage");
  return { canManage, isReadOnly: !canManage };
}
