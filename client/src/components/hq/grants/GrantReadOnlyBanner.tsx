import React from "react";
import { Shield } from "lucide-react";
import { useGrantManage } from "../../../hooks/useGrantManage";

/** Shown for board and read-only grant viewers — mutations are hidden server-side too. */
export const GrantReadOnlyBanner: React.FC = () => {
  const { isReadOnly } = useGrantManage();
  if (!isReadOnly) return null;
  return (
    <div
      className="hq-panel hq-fade-in"
      style={{
        padding: "0.65rem 1rem",
        marginBottom: "1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        fontSize: "0.85rem",
        color: "var(--hq-text-muted)",
        borderColor: "var(--hq-border-subtle)",
      }}
      role="status"
    >
      <Shield size={16} style={{ color: "var(--hq-gold)", flexShrink: 0 }} />
      <span>
        <strong style={{ color: "var(--hq-gold)" }}>View only</strong> — you can review grant data but cannot
        create, edit, or sync records. Contact a grant manager for changes.
      </span>
    </div>
  );
};
