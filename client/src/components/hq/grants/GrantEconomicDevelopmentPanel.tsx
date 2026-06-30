import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, GraduationCap, Link2, Users } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { KpiCard } from "../KpiCard";
import { formatDateTime } from "../../../utils/safeFormat";

export const GrantEconomicDevelopmentPanel: React.FC = () => {
  const snapshot = useQuery({
    queryKey: ["grant-v5-ed-workforce"],
    queryFn: grantsApi.v5EconomicDevelopmentWorkforce,
    staleTime: 60_000,
  });

  if (snapshot.isLoading) return <HqLoading message="Loading Economic Development workforce metrics…" />;

  const metrics = snapshot.data?.metrics ?? {};
  const participants = Number(metrics.participants ?? 0);
  const jobsPlaced = Number(metrics.jobsPlaced ?? 0);
  const training = Number(metrics.trainingCompletions ?? 0);
  const linkedClients = Number(metrics.linkedClients ?? 0);

  return (
    <HqPanel
      title="Economic Development Workforce"
      subtitle="Workforce pipeline metrics linked to grant funding and case management"
      action={{ label: "ED Program", to: "/hq/programs/economic-development" }}
    >
      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard label="Active Participants" value={participants} icon={Users} />
        <KpiCard label="Jobs Placed" value={jobsPlaced} icon={Briefcase} variant="success" />
        <KpiCard label="Training Completions" value={training} icon={GraduationCap} variant="gold" />
        <KpiCard label="Linked Case Clients" value={linkedClients} icon={Link2} />
      </div>
      {snapshot.data?.summary && (
        <p className="hq-muted-text" style={{ marginBottom: "0.5rem" }}>
          {snapshot.data.summary}
        </p>
      )}
      {snapshot.data?.lastSync && (
        <p className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
          Last sync: {formatDateTime(snapshot.data.lastSync)}
        </p>
      )}
      {snapshot.isError && (
        <p className="hq-muted-text">Workforce metrics unavailable — Economic Development connector may not be configured yet.</p>
      )}
    </HqPanel>
  );
};
