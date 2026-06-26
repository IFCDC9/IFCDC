import React from "react";
import { Link } from "react-router-dom";
import { Construction, Link2 } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { EnterpriseModuleHub } from "./EnterpriseModuleHub";
import type { HQModuleConfig } from "../../config/hqNavigation";

interface ModulePlaceholderProps {
  config: HQModuleConfig;
  ctaTo?: string;
  ctaLabel?: string;
}

export const ModulePlaceholder: React.FC<ModulePlaceholderProps> = ({
  config,
  ctaTo,
  ctaLabel = "Return to Dashboard",
}) => {
  const statusVariant =
    config.status === "live" ? "success" : config.status === "beta" ? "warning" : "muted";

  return (
    <div className="hq-placeholder">
      <div className="hq-placeholder-icon">
        <Construction size={28} />
      </div>
      <StatusBadge
        label={config.status === "live" ? "Live" : config.status === "beta" ? "Beta" : "Coming Soon"}
        variant={statusVariant}
      />
      <h2 style={{ marginTop: "1rem" }}>{config.title}</h2>
      <p>{config.description}</p>
      <div className="hq-placeholder-features">
        {config.features.map((f) => (
          <span key={f} className="hq-placeholder-feature">
            {f}
          </span>
        ))}
      </div>
      {config.status === "coming-soon" && (
        <div style={{ marginTop: "2rem", textAlign: "left", maxWidth: 720, margin: "2rem auto 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", color: "var(--hq-gold)", fontSize: "0.85rem", fontWeight: 600 }}>
            <Link2 size={16} /> Connected through Headquarters
          </div>
          <EnterpriseModuleHub compact />
        </div>
      )}
      {ctaTo && (
        <Link to={ctaTo} className="hq-btn hq-btn-primary" style={{ marginTop: "1.5rem" }}>
          {ctaLabel}
        </Link>
      )}
    </div>
  );
};
