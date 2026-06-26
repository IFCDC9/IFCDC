import React from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { HqLoading } from "./HqLoading";

/** Auth gate that keeps HQ layout visible while session resolves */
export const HqAuthGate: React.FC<{ path: string; children: React.ReactNode }> = ({ path, children }) => {
  const { user, loading, canAccessRoute } = useAuth();

  if (loading) {
    return <HqLoading message="Verifying your Headquarters session…" />;
  }

  if (!user) {
    return (
      <div className="hq-panel" style={{ padding: "1.5rem", maxWidth: 480 }}>
        <h3 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Sign in required</h3>
        <p style={{ color: "var(--hq-text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          Your Headquarters session is not active. Sign in as Founder to continue.
        </p>
        <Link to="/login" className="hq-btn hq-btn-primary">Go to Login</Link>
      </div>
    );
  }

  if (!canAccessRoute(path)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};
