import React, { useEffect, useState } from "react";

interface StaffingRole {
  id: string;
  roleKey: string;
  roleName: string;
  targetCount: number;
  activeCount: number;
  onboardingCount: number;
  openCount: number;
}

interface StaffingSummary {
  totalTarget: number;
  totalActive: number;
  totalOnboarding: number;
  totalOpen: number;
}

interface Props {
  onRemove: () => void;
}

export default function StaffingOverviewWidget({ onRemove }: Props) {
  const [overview, setOverview] = useState<StaffingRole[]>([]);
  const [summary, setSummary] = useState<StaffingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/hr/staffing-overview", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setOverview(data.overview);
        setSummary(data.summary);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="widget-content" data-testid="widget-staffing-overview">
      <div className="widget-header">
        <span className="widget-title">Staffing Overview</span>
        <button className="widget-remove-btn" onClick={onRemove} data-testid="btn-remove-widget">×</button>
      </div>
      {loading ? (
        <div className="widget-loading">Loading...</div>
      ) : error ? (
        <div className="widget-error">Failed to load staffing data</div>
      ) : (
        <div className="staffing-overview-content">
          {summary && (
            <div className="staffing-summary" data-testid="staffing-summary">
              <div className="staffing-summary-item">
                <span className="staffing-summary-value">{summary.totalOpen}</span>
                <span className="staffing-summary-label">Open Positions</span>
              </div>
              <div className="staffing-summary-item">
                <span className="staffing-summary-value">{summary.totalActive}</span>
                <span className="staffing-summary-label">Active Staff</span>
              </div>
              <div className="staffing-summary-item">
                <span className="staffing-summary-value">{summary.totalOnboarding}</span>
                <span className="staffing-summary-label">Onboarding</span>
              </div>
            </div>
          )}
          <div className="staffing-roles-list">
            {overview.map((role) => (
              <div 
                key={role.id} 
                className={`staffing-role-row ${role.openCount > 0 ? "has-openings" : ""}`}
                data-testid={`staffing-role-${role.roleKey}`}
              >
                <span className="staffing-role-name">{role.roleName}</span>
                <span className="staffing-role-counts">
                  <span className="staffing-active">{role.activeCount}/{role.targetCount}</span>
                  {role.openCount > 0 && (
                    <span className="staffing-open">({role.openCount} open)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <a href="/admin/hr" className="staffing-hire-link" data-testid="link-hire-staff">
            Go to HR to Hire Staff
          </a>
        </div>
      )}
    </div>
  );
}
