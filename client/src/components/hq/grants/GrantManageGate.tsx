import React from "react";
import { useGrantManage } from "../../../hooks/useGrantManage";

/** Renders mutation controls only for users with hq.grants.manage (or founder/owner). */
export const GrantManageGate: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null,
}) => {
  const { canManage } = useGrantManage();
  if (!canManage) return <>{fallback}</>;
  return <>{children}</>;
};
