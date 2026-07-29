import React from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  meta?: string;
  icon?: LucideIcon;
  variant?: "gold" | "success" | "warning" | "danger" | "muted";
  /** When set, the whole card navigates to this HQ path. */
  to?: string;
  /** When set (and no `to`), the whole card is a button that runs this handler. */
  onClick?: () => void;
  active?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  meta,
  icon: Icon,
  variant = "gold",
  to,
  onClick,
  active,
}) => {
  const body = (
    <>
      {Icon && <Icon className="hq-kpi-icon" size={28} aria-hidden />}
      <div className="hq-kpi-label">{label}</div>
      <div className={`hq-kpi-value ${variant !== "gold" ? variant : ""}`}>{value}</div>
      {meta && <div className="hq-kpi-meta">{meta}</div>}
    </>
  );

  const className = `hq-kpi-card${to || onClick ? " hq-kpi-card--link" : ""}${active ? " hq-kpi-card--active" : ""}`;

  if (to) {
    return (
      <Link to={to} className={className} aria-label={`${label}: ${value}. Open ${to}`}>
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-pressed={active}
        aria-label={`${label}: ${value}. Filter or open related records`}
      >
        {body}
      </button>
    );
  }

  return <div className="hq-kpi-card">{body}</div>;
};
