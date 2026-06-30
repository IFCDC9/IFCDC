import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Target, Calendar, AlertTriangle, Plus, Link2, CheckCircle } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { clientsApi, type ClientRecord } from "../../api/clientsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { formatDateTime } from "../../utils/safeFormat";

const PROGRAM_FILTERS = [
  { key: "", label: "All Programs" },
  { key: "ECON_DEV", label: "Economic Development" },
  { key: "MENTAL_HEALTH", label: "Mental Health" },
  { key: "BARBERSHOP", label: "Barbershop" },
  { key: "ANTI_GANG", label: "Anti-Gang" },
];

const ClientCaseManagementPage: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [programFilter, setProgramFilter] = useState("");
  const [view, setView] = useState<"registry" | "appointments">("registry");
  const [showNew, setShowNew] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [newClient, setNewClient] = useState({ fullName: "", phone: "", email: "", programs: "" });
  const qc = useQueryClient();

  const overview = useQuery({ queryKey: ["clients-overview"], queryFn: clientsApi.overview, staleTime: 30_000 });
  const clients = useQuery({
    queryKey: ["clients-list", programFilter],
    queryFn: () => clientsApi.list(programFilter || undefined),
    staleTime: 30_000,
  });
  const appointments = useQuery({
    queryKey: ["clients-appointments"],
    queryFn: () => clientsApi.appointments(),
    staleTime: 30_000,
    enabled: view === "appointments",
  });
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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["clients-list"] });
      qc.invalidateQueries({ queryKey: ["clients-overview"] });
      setShowNew(false);
      setNewClient({ fullName: "", phone: "", email: "", programs: "" });
      setSelectedId(data.id);
      const link = (data as ClientRecord & { peopleLink?: { personId: string; linked: boolean } }).peopleLink;
      setCreateNotice(
        link?.personId
          ? `Client created and linked to People registry (${link.linked ? "existing" : "new"} person ${link.personId})`
          : "Client created successfully",
      );
    },
  });

  const linkPeople = useMutation({
    mutationFn: (id: string) => clientsApi.linkPeople(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-detail", selectedId] }),
  });

  if (overview.isLoading) return <HqLoading message="Loading Client & Case Management…" />;

  const ov = overview.data;
  const peopleRegistry = detail.data?.peopleRegistry as { linked: boolean; personId?: string } | undefined;

  return (
    <HQLayout
      title="Client & Case Management"
      subtitle="Enterprise caseload registry — shared HQ auth, people bridge, and executive reporting"
    >
      <div className="hq-sd-toolbar" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <StatusBadge label="HQ Module M2.2" variant="success" />
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${view === "registry" ? "hq-btn-primary" : "hq-btn-ghost"}`}
          onClick={() => setView("registry")}
        >
          Client Registry
        </button>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${view === "appointments" ? "hq-btn-primary" : "hq-btn-ghost"}`}
          onClick={() => setView("appointments")}
        >
          <Calendar size={14} /> Appointments
        </button>
        <select
          className="hq-input hq-btn-sm"
          value={programFilter}
          onChange={(e) => setProgramFilter(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          {PROGRAM_FILTERS.map((p) => (
            <option key={p.key || "all"} value={p.key}>{p.label}</option>
          ))}
        </select>
        <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => setShowNew(!showNew)}>
          <Plus size={14} /> New Client
        </button>
      </div>

      {createNotice && (
        <div className="hq-fade-in" style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--hq-bg-subtle)", borderRadius: 6, fontSize: "0.85rem" }}>
          <CheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          {createNotice}
          <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" style={{ marginLeft: "0.5rem" }} onClick={() => setCreateNotice(null)}>Dismiss</button>
        </div>
      )}

      {showNew && (
        <HqPanel title="Register Client" subtitle="Creates client record, assigns to your caseload, and auto-links to People registry" style={{ marginBottom: "1rem" }}>
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

      {view === "appointments" ? (
        <HqPanel title="Upcoming Appointments" subtitle="Scoped to your caseload (executives see all)">
          {appointments.isLoading ? <HqLoading /> : (
            <ul className="hq-activity-list">
              {(appointments.data?.appointments ?? []).map((a) => (
                <li key={String(a.id)} className="hq-activity-item" style={{ cursor: "pointer" }} onClick={() => { setView("registry"); setSelectedId(String(a.clientId)); }}>
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{String(a.clientName)} — {String(a.program)}</div>
                    <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>
                      {formatDateTime(String(a.startTime))}{a.location ? ` · ${String(a.location)}` : ""}
                    </div>
                  </div>
                </li>
              ))}
              {!appointments.data?.appointments?.length && <li className="hq-muted-text">No upcoming appointments in range</li>}
            </ul>
          )}
        </HqPanel>
      ) : (
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
                !peopleRegistry?.linked ? (
                  <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={linkPeople.isPending} onClick={() => linkPeople.mutate(selectedId)}>
                    <Link2 size={14} /> Link to People DB
                  </button>
                ) : (
                  <StatusBadge label={`People: ${peopleRegistry.personId}`} variant="success" />
                )
              }
            >
              {detail.isLoading ? <HqLoading /> : detail.data ? (
                <div className="hq-fade-in">
                  <p><strong>{(detail.data.client as { fullName?: string })?.fullName}</strong></p>
                  <p className="hq-muted-text" style={{ fontSize: "0.85rem" }}>
                    Programs: {((detail.data.client as { programs?: string[] })?.programs ?? []).join(", ") || "—"}
                  </p>
                  {(detail.data.nextAppointment as { startTime?: string } | null)?.startTime && (
                    <p style={{ fontSize: "0.85rem" }}>Next appointment: {formatDateTime((detail.data.nextAppointment as { startTime: string }).startTime)}</p>
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
                    {!((detail.data.goals as unknown[]) ?? []).length && <li className="hq-muted-text">No goals recorded</li>}
                  </ul>
                </div>
              ) : (
                <p className="hq-muted-text">Unable to load case summary</p>
              )}
            </HqPanel>
          )}
        </div>
      )}
    </HQLayout>
  );
};

export default ClientCaseManagementPage;
