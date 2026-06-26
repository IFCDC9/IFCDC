import React from "react";

type BadgeVariant = "success" | "warning" | "danger" | "gold" | "muted" | "locked";

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  pulse?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, variant = "muted", pulse }) => (
  <span className={`hq-badge ${variant}`}>
    {pulse && <span className="hq-badge-dot" />}
    {label}
  </span>
);
