import React, { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { getWidgetData } from "../../api/dashboardApi";

interface Props {
  onRemove: () => void;
}

export default function ClientStatsWidget({ onRemove }: Props) {
  const { token } = useAuth();
  const [data, setData] = useState<{ totalClients: number; activePrograms: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    getWidgetData(token, "client_stats")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="widget-content" data-testid="widget-client-stats">
      <div className="widget-header">
        <span className="widget-title">Client Statistics</span>
        <button className="widget-remove-btn" onClick={onRemove} data-testid="btn-remove-widget">×</button>
      </div>
      {loading ? (
        <div className="widget-loading">Loading...</div>
      ) : data ? (
        <div className="widget-stats-grid">
          <div className="widget-stat">
            <div className="widget-stat-value">{data.totalClients}</div>
            <div className="widget-stat-label">Total Clients</div>
          </div>
          <div className="widget-stat">
            <div className="widget-stat-value">{data.activePrograms}</div>
            <div className="widget-stat-label">Programs</div>
          </div>
        </div>
      ) : (
        <div className="widget-error">Failed to load</div>
      )}
    </div>
  );
}
