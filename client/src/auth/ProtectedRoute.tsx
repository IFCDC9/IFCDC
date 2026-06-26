import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { Permission } from "./enterpriseAuth";

type Props = {
  children: React.ReactNode;
  /** Legacy role allow-list */
  allowedRoles?: string[];
  /** Enterprise permission required */
  requiredPermission?: Permission;
  /** HQ route path for permission check */
  requiredRoute?: string;
};

const ProtectedRoute: React.FC<Props> = ({
  children,
  allowedRoles,
  requiredPermission,
  requiredRoute,
}) => {
  const { user, loading, hasPermission, canAccessRoute } = useAuth();

  if (loading) {
    return (
      <div className="hq-shell" style={{ alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="hq-loading">
          <div className="hq-spinner" />
          Authenticating…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requiredRoute && !canAccessRoute(requiredRoute)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role) && user.role !== "owner") {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};

export default ProtectedRoute;
