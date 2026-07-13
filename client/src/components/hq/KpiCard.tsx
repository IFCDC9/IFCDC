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
}

export const KpiCard: React.FC<KpiCardProps> = ({ label, value, meta, icon: Icon, variant = "gold", to }) => {
  const body = (
    <>
      {Icon && <Icon className="hq-kpi-icon" size={28} aria-hidden />}
      <div className="hq-kpi-label">{label}</div>
      <div className={`hq-kpi-value ${variant !== "gold" ? variant : ""}`}>{value}</div>
      {meta && <div className="hq-kpi-meta">{meta}</div>}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="hq-kpi-card hq-kpi-card--link"
        aria-label={`${label}: ${value}. Open ${to}`}
      >
        {body}
      </Link>
    );
  }

  return <div className="hq-kpi-card">{body}</div>;
};
