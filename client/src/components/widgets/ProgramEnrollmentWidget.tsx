import React, { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { getWidgetData } from "../../api/dashboardApi";

interface ProgramData {
  code: string;
  name: string;
  client_count: number;
}

interface Props {
  onRemove: () => void;
}

export default function ProgramEnrollmentWidget({ onRemove }: Props) {
  const { token } = useAuth();
  const [data, setData] = useState<ProgramData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    getWidgetData(token, "program_enrollment")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const maxCount = Math.max(...data.map((p) => p.client_count), 1);

  return (
    <div className="widget-content" data-testid="widget-program-enrollment">
      <div className="widget-header">
        <span className="widget-title">Program Enrollment</span>
        <button className="widget-remove-btn" onClick={onRemove} data-testid="btn-remove-widget">×</button>
      </div>
      {loading ? (
        <div className="widget-loading">Loading...</div>
      ) : data.length > 0 ? (
        <div className="widget-bars">
          {data.map((prog) => (
            <div key={prog.code} className="widget-bar-row" data-testid={`program-${prog.code}`}>
              <div className="widget-bar-label">{prog.name}</div>
              <div className="widget-bar-container">
                <div
                  className="widget-bar-fill"
                  style={{ width: `${(prog.client_count / maxCount) * 100}%` }}
                />
                <span className="widget-bar-value">{prog.client_count}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="widget-empty">No programs</div>
      )}
    </div>
  );
}
