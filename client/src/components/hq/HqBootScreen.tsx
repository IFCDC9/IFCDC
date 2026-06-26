import React from "react";

/** Visible fallback while HQ routes or dashboard chunks load */
export const HqBootScreen: React.FC<{ message?: string }> = ({ message = "Loading Headquarters…" }) => (
  <div className="hq-shell" style={{ alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
    <div className="hq-loading">
      <div className="hq-spinner" />
      {message}
    </div>
  </div>
);
