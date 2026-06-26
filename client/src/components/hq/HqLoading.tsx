import React from "react";

export const HqLoading: React.FC<{ message?: string }> = ({ message = "Loading…" }) => (
  <div
    className="hq-loading"
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      color: "#f5c842",
      gap: "0.75rem",
      minHeight: "120px",
    }}
  >
    <div
      className="hq-spinner"
      style={{
        width: 20,
        height: 20,
        border: "2px solid rgba(245,200,66,0.35)",
        borderTopColor: "#f5c842",
        borderRadius: "50%",
        animation: "hq-spin 0.8s linear infinite",
      }}
      aria-hidden="true"
    />
    <span>{message}</span>
  </div>
);
