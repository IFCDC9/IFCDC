import React from "react";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  meta?: string;
  icon?: LucideIcon;
  variant?: "gold" | "success" | "warning" | "danger" | "muted";
}

export const KpiCard: React.FC<KpiCardProps> = ({ label, value, meta, icon: Icon, variant = "gold" }) => (
  <div className="hq-kpi-card">
    {Icon && <Icon className="hq-kpi-icon" size={28} />}
    <div className="hq-kpi-label">{label}</div>
    <div className={`hq-kpi-value ${variant !== "gold" ? variant : ""}`}>{value}</div>
    {meta && <div className="hq-kpi-meta">{meta}</div>}
  </div>
);
