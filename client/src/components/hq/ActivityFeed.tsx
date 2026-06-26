import React from "react";
import { Link } from "react-router-dom";
import { DollarSign, Users, FileText, Activity, AlertTriangle, Shield, Monitor } from "lucide-react";
import type { ActivityItem } from "../../api/hqApi";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  donation: <DollarSign size={16} />,
  grant: <FileText size={16} />,
  hr: <Users size={16} />,
  expense: <DollarSign size={16} />,
  payroll: <DollarSign size={16} />,
  compliance: <Shield size={16} />,
  alert: <AlertTriangle size={16} />,
  deployment: <Monitor size={16} />,
  program: <Activity size={16} />,
};

const TYPE_PATHS: Record<string, (item: ActivityItem) => string | undefined> = {
  donation: () => "/hq/donations",
  grant: () => "/hq/grants",
  hr: (item) => item.id.startsWith("person-") ? `/hq/people?id=${item.id.replace("person-", "")}` : "/hq/people",
  payroll: () => "/hq/payroll",
  compliance: () => "/hq/grants",
  alert: () => "/hq/software",
  expense: () => "/hq/finance",
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export const ActivityFeed: React.FC<{ items: ActivityItem[]; linkable?: boolean }> = ({ items, linkable = false }) => {
  if (!items.length) {
    return <div className="hq-empty">No recent activity yet. Organization events will appear here.</div>;
  }

  return (
    <ul className="hq-activity-list">
      {items.map((item) => {
        const path = linkable ? TYPE_PATHS[item.type]?.(item) : undefined;
        const content = (
          <>
            <div className="hq-activity-icon">
              {TYPE_ICONS[item.type] || <Activity size={16} />}
            </div>
            <div className="hq-activity-content">
              <div className="hq-activity-title">{item.title}</div>
              <div className="hq-activity-detail">{item.detail}</div>
            </div>
            <div className="hq-activity-time">{formatTime(item.timestamp)}</div>
          </>
        );

        return (
          <li key={item.id} className={`hq-activity-item ${path ? "hq-activity-linkable" : ""}`}>
            {path ? (
              <Link to={path} className="hq-activity-link">{content}</Link>
            ) : content}
          </li>
        );
      })}
    </ul>
  );
};
