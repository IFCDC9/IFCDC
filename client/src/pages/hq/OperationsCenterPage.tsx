import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Package, Truck, Building, Shield, Calendar, AlertTriangle, Wrench, Home } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { operationsApi, type BarbersSnapshotSection } from "../../api/operationsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { OperationsPhase3CommandCenter } from "../../components/hq/people/OperationsPhase3CommandCenter";
import { ExecutiveOperationsFoundation } from "../../components/hq/operations/ExecutiveOperationsFoundation";

const MODULE_LINKS = [
  { label: "Asset & Inventory", path: "/hq/assets", icon: Package, key: "assets" as const },
  { label: "Fleet & Vehicles", path: "/hq/fleet", icon: Truck, key: "fleet" as const },
  { label: "Facilities & Property", path: "/hq/facilities", icon: Building, key: "facilities" as const },
  { label: "Compliance & Risk", path: "/hq/compliance", icon: Shield, key: "compliance" as const },
  { label: "Organization Calendar", path: "/hq/calendar", icon: Calendar, key: "calendar" as const },
  { label: "Housing Programs", path: "/hq/housing", icon: Home, key: "housing" as const },
];

function snapshotValue(section: BarbersSnapshotSection | undefined): string {
  if (!section || section.status !== "ok" || section.count == null) {
    return section?.status === "unavailable" ? "Unavailable" : "Not connected";
  }
  if (section.count === 0 && section.emptyBecause === "closed_day") return "0 closed";
  return String(section.count);
}

const OperationsCenterPage: React.FC = () => {
  const overview = useQuery({
    queryKey: ["ops-overview"],
    queryFn: operationsApi.overview,
    staleTime: 45_000,
    retry: 1,
  });
  const barbersSnapshot = useQuery({
    queryKey: ["ops-barbers-snapshot"],
    queryFn: operationsApi.barbersSnapshot,
    staleTime: 45_000,
    retry: 1,
  });

  if (overview.isLoading && !overview.data) {
    return (
      <HQLayout title="Executive Operations Center" subtitle="Build 60 — unified command for IFCDC departments, workforce, compliance, and automation">
        <HqLoading message="Loading operations overview…" />
      </HQLayout>
    );
  }

  const ops = overview.data;
  const riskLevel = (ops?.compliance.highRisks ?? 0) > 0 ? "danger" : (ops?.compliance.openRisks ?? 0) > 0 ? "warning" : "success";

  return (
    <HQLayout title="Executive Operations Center" subtitle="Build 60 — unified command for IFCDC departments, workforce, compliance, projects, and automation">
      {overview.isError && !ops && (
        <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>Operations overview unavailable</strong>
            <span>Live operations metrics did not load.</span>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => void overview.refetch()}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: "1.25rem" }}>
        <ExecutiveOperationsFoundation />
      </div>

      <div style={{ marginBottom: "1.25rem" }}>
        <OperationsPhase3CommandCenter />
      </div>

      <div id="barbers-snapshot" style={{ marginBottom: "1.25rem" }}>
        <HqPanel
          title="Barbers operations"
          subtitle="Read-only production snapshot. Headquarters housing, fleet, and program counts stay separate."
        >
          {barbersSnapshot.isLoading && <p className="hq-muted-text">Reading Barbers…</p>}
          {barbersSnapshot.isError && (
            <p className="hq-muted-text">Barbers snapshot did not load. Headquarters operations above are unchanged.</p>
          )}
          {barbersSnapshot.data && (
            <>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <StatusBadge
                  label={
                    barbersSnapshot.data.sourceHealth === "ok"
                      ? "Source healthy"
                      : barbersSnapshot.data.sourceHealth === "not_configured"
                        ? "Booking ledger not connected"
                        : "Source unavailable"
                  }
                  variant={
                    barbersSnapshot.data.sourceHealth === "ok"
                      ? "success"
                      : barbersSnapshot.data.sourceHealth === "not_configured"
                        ? "warning"
                        : "danger"
                  }
                />
                <span className="hq-muted-text">
                  {barbersSnapshot.data.source.host || "No Barbers host"}
                  {barbersSnapshot.data.refreshedAt
                    ? ` · refreshed ${new Date(barbersSnapshot.data.refreshedAt).toLocaleString()}`
                    : " · no successful refresh"}
                </span>
              </div>
              <div className="hq-kpi-grid">
                <KpiCard label="Today's bookings" value={snapshotValue(barbersSnapshot.data.todayBookings)} icon={Calendar} />
                <KpiCard label="Upcoming bookings" value={snapshotValue(barbersSnapshot.data.upcomingBookings)} icon={Calendar} />
                <KpiCard label="Openings" value={snapshotValue(barbersSnapshot.data.openings)} icon={Calendar} variant="gold" />
                <KpiCard label="Shop status" value={snapshotValue(barbersSnapshot.data.shopStatus)} icon={Building} />
                <KpiCard label="Reschedules" value={snapshotValue(barbersSnapshot.data.reschedules)} icon={Calendar} />
                <KpiCard label="Cancellations" value={snapshotValue(barbersSnapshot.data.cancellations)} icon={AlertTriangle} />
                <KpiCard label="Exceptions" value={snapshotValue(barbersSnapshot.data.exceptions)} icon={AlertTriangle} variant="warning" />
              </div>
              {[
                barbersSnapshot.data.todayBookings,
                barbersSnapshot.data.upcomingBookings,
                barbersSnapshot.data.openings,
                barbersSnapshot.data.shopStatus,
                barbersSnapshot.data.reschedules,
                barbersSnapshot.data.cancellations,
                barbersSnapshot.data.exceptions,
              ].some((section) => section.unavailableReason) && (
                <ul className="hq-activity-list" style={{ margin: "0.75rem 0 0", padding: 0, listStyle: "none" }}>
                  {[
                    ["Today's bookings", barbersSnapshot.data.todayBookings],
                    ["Upcoming bookings", barbersSnapshot.data.upcomingBookings],
                    ["Openings", barbersSnapshot.data.openings],
                    ["Shop status", barbersSnapshot.data.shopStatus],
                    ["Reschedules", barbersSnapshot.data.reschedules],
                    ["Cancellations", barbersSnapshot.data.cancellations],
                    ["Exceptions", barbersSnapshot.data.exceptions],
                  ].map(([label, section]) => {
                    const row = section as BarbersSnapshotSection;
                    if (!row.unavailableReason) return null;
                    return (
                      <li key={String(label)} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{String(label)}</div>
                          <div className="hq-activity-detail">{row.unavailableReason}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </HqPanel>
      </div>

      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Assets Tracked" value={ops?.assets.total ?? 0} icon={Package} variant="gold" />
        <KpiCard label="Fleet Vehicles" value={ops?.fleet.vehicles ?? 0} icon={Truck} />
        <KpiCard label="Properties" value={ops?.facilities.properties ?? 0} icon={Building} />
        <KpiCard label="Open Work Orders" value={ops?.facilities.openWorkOrders ?? 0} icon={Wrench} variant={(ops?.facilities.openWorkOrders ?? 0) > 0 ? "warning" : "muted"} />
        <KpiCard label="Compliance Risks" value={ops?.compliance.openRisks ?? 0} icon={AlertTriangle} variant={riskLevel} />
        <KpiCard label="Upcoming Events" value={ops?.calendar.upcomingEvents ?? 0} icon={Calendar} />
      </div>

      <div className="hq-grid-2 hq-fade-in">
        <HqPanel title="Operations Modules" subtitle="Navigate to specialized operations centers">
          <div className="hq-app-grid">
            {MODULE_LINKS.map((m) => {
              if (!m?.path || !m.icon) return null;
              const Icon = m.icon;
              return (
              <Link key={m.path} to={m.path} className="hq-app-card hq-entity-link">
                <Icon size={20} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
                <div className="hq-app-name">{m.label}</div>
                {ops && m.key === "fleet" && (ops.fleet.maintenanceDue > 0) && (
                  <StatusBadge label={`${ops.fleet.maintenanceDue} service due`} variant="warning" />
                )}
                {ops && m.key === "compliance" && (ops.compliance.highRisks > 0) && (
                  <StatusBadge label={`${ops.compliance.highRisks} high risk`} variant="danger" />
                )}
              </Link>
              );
            })}
          </div>
        </HqPanel>

        <HqPanel title="Operational Alerts" subtitle="Maintenance, risk, and incident indicators">
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {(ops?.fleet.maintenanceDue ?? 0) > 0 && (
              <li className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">Fleet maintenance due</div>
                  <div className="hq-activity-detail">{ops!.fleet.maintenanceDue} vehicle(s) require service</div>
                </div>
                <Link to="/hq/fleet" className="hq-entity-link">Review →</Link>
              </li>
            )}
            {(ops?.facilities.openWorkOrders ?? 0) > 0 && (
              <li className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">Open facility work orders</div>
                  <div className="hq-activity-detail">{ops!.facilities.openWorkOrders} work order(s) pending</div>
                </div>
                <Link to="/hq/facilities" className="hq-entity-link">Review →</Link>
              </li>
            )}
            {(ops?.compliance.openRisks ?? 0) > 0 && (
              <li className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">Compliance risks open</div>
                  <div className="hq-activity-detail">{ops!.compliance.openRisks} risk(s) · {ops!.compliance.highRisks} high severity</div>
                </div>
                <Link to="/hq/compliance" className="hq-entity-link">Risk register →</Link>
              </li>
            )}
            {!ops?.fleet.maintenanceDue && !ops?.facilities.openWorkOrders && !ops?.compliance.openRisks && (
              <li className="hq-muted-text">All operational indicators within normal range.</li>
            )}
          </ul>
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default OperationsCenterPage;
