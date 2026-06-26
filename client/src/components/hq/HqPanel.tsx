import React from "react";
import { Link } from "react-router-dom";

interface HqPanelProps {
  title: string;
  subtitle?: string;
  action?: { label: string; to: string };
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const HqPanel: React.FC<HqPanelProps> = ({ title, subtitle, action, headerExtra, children, className = "" }) => (
  <div className={`hq-panel ${className}`}>
    <div className="hq-panel-header">
      <div>
        <div className="hq-panel-title">{title}</div>
        {subtitle && <div className="hq-panel-subtitle">{subtitle}</div>}
      </div>
      <div className="hq-panel-header-actions">
        {headerExtra}
        {action && (
          <Link to={action.to} className="hq-panel-action">
            {action.label} →
          </Link>
        )}
      </div>
    </div>
    <div className="hq-panel-body">{children}</div>
  </div>
);
