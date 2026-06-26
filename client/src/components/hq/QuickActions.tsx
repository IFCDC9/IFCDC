import React from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export interface QuickAction {
  label: string;
  to: string;
  icon: LucideIcon;
}

export const QuickActions: React.FC<{ actions: QuickAction[] }> = ({ actions }) => (
  <div className="hq-quick-actions">
    {actions.map((a) => {
      const Icon = a.icon;
      return (
      <Link key={a.to} to={a.to} className="hq-quick-action">
        <Icon size={16} />
        {a.label}
      </Link>
      );
    })}
  </div>
);
