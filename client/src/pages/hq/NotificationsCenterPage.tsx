import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Shield, FileText, Monitor, AlertTriangle, Users, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import HQLayout from "../../layouts/HQLayout";
import { enterpriseApi, type EnterpriseNotification } from "../../api/enterpriseApi";
import { phase9Api } from "../../api/phase9Api";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { ActivityFeed } from "../../components/hq/ActivityFeed";
import { analyticsApi } from "../../api/analyticsApi";
import { formatDateTime } from "../../utils/safeFormat";

const TYPE_ICONS: Record<string, React.ElementType> = {
  compliance: Shield,
  grant: FileText,
  software: Monitor,
  alert: AlertTriangle,
  hr: Users,
  finance: Wallet,
  system: Bell,
};

function formatTime(ts: string): string {
  return formatDateTime(ts);
}

const NotificationsCenterPage: React.FC = () => {
  const [filter, setFilter] = useState<"all" | "unread" | "high">("all");
  const qc = useQueryClient();

  const notifs = useQuery({ queryKey: ["enterprise-notifications"], queryFn: enterpriseApi.notifications, refetchInterval: 30_000 });
  const priorityQueue = useQuery({ queryKey: ["phase9-notifications"], queryFn: phase9Api.notifications, refetchInterval: 30_000 });
  const activity = useQuery({ queryKey: ["analytics-activity-notif"], queryFn: () => analyticsApi.activity(12) });

  const markRead = useMutation({
    mutationFn: (id: string) => phase9Api.markRead(id).catch(() => enterpriseApi.markRead(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enterprise-notifications"] });
      qc.invalidateQueries({ queryKey: ["phase9-notifications"] });
    },
  });

  const legacyItems = notifs.data?.notifications ?? [];
  const queueItems = priorityQueue.data?.notifications ?? [];
  const items = queueItems.length > 0 ? queueItems : legacyItems;
  const executiveQueue = priorityQueue.data?.executiveQueue ?? [];
  const filtered = items.filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "high") return n.priority === "high";
    return true;
  });

  return (
    <HQLayout
      title="Enterprise Notifications"
      subtitle="Organization-wide alerts, compliance reminders, and system events"
    >
      <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <div className="hq-kpi-card">
          <div className="hq-kpi-label">Unread</div>
          <div className="hq-kpi-value warning">{notifs.data?.unreadCount ?? 0}</div>
        </div>
        <div className="hq-kpi-card">
          <div className="hq-kpi-label">Total Alerts</div>
          <div className="hq-kpi-value">{items.length}</div>
        </div>
        <div className="hq-kpi-card">
          <div className="hq-kpi-label">High Priority</div>
          <div className="hq-kpi-value">{priorityQueue.data?.highPriorityCount ?? items.filter((n) => n.priority === "high").length}</div>
        </div>
      </div>

      {executiveQueue.length > 0 && (
        <HqPanel title="Executive Priority Queue" subtitle="Alerts requiring founder or executive attention" className="hq-mb-md">
          <ul className="hq-activity-list">
            {(executiveQueue as { title: string; message: string; priority: string }[]).slice(0, 5).map((e, i) => (
              <li key={i} className="hq-activity-item">
                <AlertTriangle size={14} style={{ color: "var(--hq-gold)" }} />
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{e.title}</div>
                  <div className="hq-activity-detail">{e.message}</div>
                </div>
                <StatusBadge label={e.priority} variant="danger" />
              </li>
            ))}
          </ul>
        </HqPanel>
      )}

      <div className="hq-tabs">
        {(["all", "unread", "high"] as const).map((f) => (
          <button key={f} type="button" className={`hq-tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "unread" ? "Unread" : "High Priority"}
          </button>
        ))}
      </div>

      <div className="hq-grid-main-side">
        <div>
          {notifs.isLoading && <HqLoading message="Loading notifications…" />}
          {!notifs.isLoading && filtered.length === 0 && (
            <div className="hq-empty">No notifications in this view. Organization alerts will appear here in real time.</div>
          )}
          <ul className="hq-notif-list">
            {filtered.map((n: EnterpriseNotification) => {
              const Icon = TYPE_ICONS[n.type] ?? Bell;
              return (
                <li key={n.id} className={`hq-notif-item ${n.read ? "read" : "unread"} ${n.priority === "high" ? "priority-high" : ""}`}>
                  <div className="hq-notif-icon"><Icon size={18} /></div>
                  <div className="hq-notif-content">
                    <div className="hq-notif-title-row">
                      <span className="hq-notif-title">{n.title}</span>
                      {!n.read && <StatusBadge label="New" variant="gold" />}
                      {n.priority === "high" && <StatusBadge label="High" variant="danger" />}
                    </div>
                    <p className="hq-notif-message">{n.message}</p>
                    <div className="hq-notif-meta">
                      <span>{formatTime(n.timestamp)}</span>
                      {n.path && <Link to={n.path} className="hq-entity-link">View in module →</Link>}
                      {!n.read && (
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => markRead.mutate(n.id)}>
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <HqPanel title="Live Activity Feed" subtitle="Cross-module organization events" action={{ label: "Analytics", to: "/hq/analytics" }}>
            <ActivityFeed items={activity.data?.activity ?? []} linkable />
          </HqPanel>
        </div>
      </div>
    </HQLayout>
  );
};

export default NotificationsCenterPage;
