import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

/**
 * Public routes (/login, /register) — always render the page immediately.
 * Redirect to HQ only after session check completes with a valid user.
 */
export const GuestRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (!loading && user) {
    const dest = user.defaultRoute && user.defaultRoute !== "/login" ? user.defaultRoute : "/hq";
    return <Navigate to={dest} replace />;
  }

  return <>{children}</>;
};
