import React, { useEffect, useState } from "react";
import { getWidgetData } from "../../api/dashboardApi";

interface AuditLog {
  id: string;
  timestamp: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
}

interface Props {
  onRemove: () => void;
}

export default function AuditLogSummaryWidget({ onRemove }: Props) {
  const [data, setData] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWidgetData("audit_log_summary")
      .then(setData)
      .catch((err) => {
        if (err.message.includes("403")) {
          setError("EXEC role required");
        } else {
          setError("Failed to load");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="widget-content" data-testid="widget-audit-log-summary">
      <div className="widget-header">
        <span className="widget-title">Recent Activity</span>
        <button className="widget-remove-btn" onClick={onRemove} data-testid="btn-remove-widget">×</button>
      </div>
      {loading ? (
        <div className="widget-loading">Loading...</div>
      ) : error ? (
        <div className="widget-error">{error}</div>
      ) : data.length > 0 ? (
        <div className="widget-list widget-list-compact">
          {data.slice(0, 8).map((log) => (
            <div key={log.id} className="widget-list-item" data-testid={`audit-${log.id}`}>
              <div className="widget-list-secondary">
                {formatTime(log.timestamp)} • {log.entity_type} • {log.action}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="widget-empty">No recent activity</div>
      )}
    </div>
  );
}
