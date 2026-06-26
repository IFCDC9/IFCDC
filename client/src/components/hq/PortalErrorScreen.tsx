import React from "react";

type Props = {
  title?: string;
  message: string;
  detail?: string;
};

/** Visible full-page error — never leave a blank screen */
export const PortalErrorScreen: React.FC<Props> = ({
  title = "IFCDC Portal failed to load",
  message,
  detail,
}) => (
  <div
    style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0a0a0a",
      color: "#f5f5f5",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      padding: "2rem",
    }}
  >
    <div
      style={{
        maxWidth: 480,
        width: "100%",
        background: "#161616",
        border: "1px solid rgba(245,200,66,0.25)",
        borderRadius: 10,
        padding: "1.5rem",
      }}
    >
      <h1 style={{ color: "#f5c842", fontSize: "1.25rem", marginBottom: "0.5rem" }}>{title}</h1>
      <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginBottom: detail ? "0.75rem" : "1.25rem" }}>{message}</p>
      {detail && (
        <pre
          style={{
            fontSize: "0.75rem",
            color: "#ef4444",
            whiteSpace: "pre-wrap",
            marginBottom: "1.25rem",
            background: "#0a0a0a",
            padding: "0.75rem",
            borderRadius: 6,
          }}
        >
          {detail}
        </pre>
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <a
          href="/login"
          style={{
            padding: "0.6rem 1.2rem",
            background: "#f5c842",
            color: "#0a0a0a",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Open Login
        </a>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "0.6rem 1.2rem",
            background: "transparent",
            border: "1px solid #555",
            color: "#aaa",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    </div>
  </div>
);
