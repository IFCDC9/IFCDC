import React, { useEffect, useState } from "react";
import { getWidgetData } from "../../api/dashboardApi";

interface Encounter {
  id: string;
  client_name: string;
  program: string;
  type: string;
  created_at: string;
}

interface Props {
  onRemove: () => void;
}

export default function RecentEncountersWidget({ onRemove }: Props) {
  const [data, setData] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWidgetData("recent_encounters")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="widget-content" data-testid="widget-recent-encounters">
      <div className="widget-header">
        <span className="widget-title">Recent Encounters</span>
        <button className="widget-remove-btn" onClick={onRemove} data-testid="btn-remove-widget">×</button>
      </div>
      {loading ? (
        <div className="widget-loading">Loading...</div>
      ) : data.length > 0 ? (
        <div className="widget-list">
          {data.slice(0, 5).map((enc) => (
            <div key={enc.id} className="widget-list-item" data-testid={`encounter-${enc.id}`}>
              <div className="widget-list-primary">{enc.client_name}</div>
              <div className="widget-list-secondary">
                {enc.program} • {enc.type} • {formatDate(enc.created_at)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="widget-empty">No recent encounters</div>
      )}
    </div>
  );
}
