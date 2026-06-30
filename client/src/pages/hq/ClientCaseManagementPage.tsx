import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Target, Calendar, AlertTriangle, Plus, Link2 } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { clientsApi, type ClientRecord } from "../../api/clientsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";

const ClientCaseManagementPage: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newClient, setNewClient] = useState({ fullName: "", phone: "", email: "", programs: "" });
  const qc = useQueryClient();

  const overview = useQuery({ queryKey: ["clients-overview"], queryFn: clientsApi.overview, staleTime: 30_000 });
  const clients = useQuery({ queryKey: ["clients-list"], queryFn: () => clientsApi.list(), staleTime: 30_000 });
  const detail = useQuery({
    queryKey: ["client-detail", selectedId],
    queryFn: () => clientsApi.summary(selectedId!),
    enabled: !!selectedId,
  });

  const createClient = useMutation({
    mutationFn: () =>
      clientsApi.create({
        fullName: newClient.fullName,
        contactInfo: { phone: newClient.phone || undefined, email: newClient.email || undefined },
        programs: newClient.programs ? newClient.programs.split(",").map((p) => p.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients-list"] });
      qc.invalidateQueries({ queryKey: ["clients-overview"] });
      setShowNew(false);
      setNewClient({ fullName: "", phone: "", email: "", programs: "" });
    },
  });

  const linkPeople = useMutation({
    mutationFn: (id: string) => clientsApi.linkPeople(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-detail", selectedId] }),
  });

  if (overview.isLoading) return <HqLoading message="Loading Client & Case Management…" />;

  const ov = overview.data;

  return (
    <HQLayout
      title="Client & Case Management"
      subtitle="Enterprise caseload registry — shared HQ auth, people bridge, and executive reporting"
    >
      <div className="hq-sd-toolbar" style={{ marginBottom: "1rem" }}>
        <StatusBadge label="HQ Module M2.1" variant="success" />
        <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => setShowNew(!showNew)}>
          <Plus size={14} /> New Client
        </button>
      </div>

      {showNew && (
        <HqPanel title="Register Client" subtitle="Creates client record and assigns to your caseload" style={{ marginBottom: "1rem" }}>
          <div className="hq-grid-2">
            <input className="hq-input" placeholder="Full name" value={newClient.fullName} onChange={(e) => setNewClient({ ...newClient, fullName: e.target.value })} />
            <input className="hq-input" placeholder="Phone" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} />
            <input className="hq-input" placeholder="Email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />
            <input className="hq-input" placeholder="Programs (comma-separated)" value={newClient.programs} onChange={(e) => setNewClient({ ...newClient, programs: e.target.value })} />
          </div>
          <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginTop: "0.75rem" }} disabled={!newClient.fullName || createClient.isPending} onClick={() => createClient.mutate()}>
            {createClient.isPending ? "Saving…" : "Create Client"}
          </button>
        </HqPanel>
      )}

      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Total Clients" value={ov?.totalClients ?? 0} icon={Users} variant="gold" />
        <KpiCard label="Active Caseloads" value={ov?.activeAssignments ?? 0} icon={Users} />
        <KpiCard label="Open Goals" value={ov?.openGoals ?? 0} icon={Target} />
        <KpiCard label="Upcoming Appointments" value={ov?.upcomingAppointments ?? 0} icon={Calendar} />
        <KpiCard label="High Risk" value={ov?.highRiskClients ?? 0} icon={AlertTriangle} variant={(ov?.highRiskClients ?? 0) > 0 ? "warning" : "muted"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selectedId ? "360px 1fr" : "1fr", gap: "1rem" }}>
        <HqPanel title="Client Registry" subtitle={`${clients.data?.count ?? 0} clients in your scope`}>
          {clients.isLoading ? <HqLoading /> : (
            <ul className="hq-activity-list">
              {(clients.data?.clients ?? []).map((c: ClientRecord) => (
                <li key={c.id} className="hq-activity-item" style={{ cursor: "pointer" }} onClick={() => setSelectedId(c.id)}>
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{c.fullName}</div>
                    <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>
                      {(c.programs ?? []).join(", ") || "No programs"}
                    </div>
                  </div>
                </li>
              ))}
              {!clients.data?.clients?.length && <li className="hq-muted-text">No clients yet</li>}
            </ul>
          )}
        </HqPanel>

        {selectedId && (
          <HqPanel
            title="Case Summary"
            subtitle="Goals, appointments, and people registry bridge"
            headerExtra={
              <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={linkPeople.isPending} onClick={() => linkPeople.mutate(selectedId)}>
                <Link2 size={14} /> Link to People DB
              </button>
            }
          >
            {detail.isLoading ? <HqLoading /> : detail.data ? (
              <div className="hq-fade-in">
                <p><strong>{(detail.data.client as { fullName?: string })?.fullName}</strong></p>
                <p className="hq-muted-text" style={{ fontSize: "0.85rem" }}>
                  Programs: {((detail.data.client as { programs?: string[] })?.programs ?? []).join(", ") || "—"}
                </p>
                {(detail.data.nextAppointment as { startTime?: string } | null)?.startTime && (
                  <p style={{ fontSize: "0.85rem" }}>Next appointment: {(detail.data.nextAppointment as { startTime: string }).startTime}</p>
                )}
                <h4 style={{ marginTop: "1rem", fontSize: "0.85rem" }}>Goals</h4>
                <ul className="hq-activity-list">
                  {((detail.data.goals as { id: string; title: string; status: string }[]) ?? []).map((g) => (
                    <li key={g.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{g.title}</div>
                        <StatusBadge label={g.status} variant={g.status === "completed" ? "success" : "muted"} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="hq-muted-text">Unable to load case summary</p>
            )}
          </HqPanel>
        )}
      </div>
    </HQLayout>
  );
};

export default ClientCaseManagementPage;
