/**
 * AURA MUSIC Command Center — IFCDC HQ module.
 * Phase 3 controlled mixing intelligence enabled (engineering racks, Mix V1).
 */
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Music2,
  RefreshCw,
  Radio,
  Library,
  FolderKanban,
  SlidersHorizontal,
  Disc3,
  AudioWaveform,
  Volume2,
  ListTodo,
  Cable,
  LayoutDashboard,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi, type AuraMusicCommandCenter } from "../../api/hqApi";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqQueryBoundary } from "../../components/hq/HqQueryBoundary";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "library", label: "Library", icon: Library },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "mix", label: "Mix", icon: SlidersHorizontal },
  { id: "master", label: "Master", icon: Disc3 },
  { id: "sampling", label: "Sampling", icon: AudioWaveform },
  { id: "sounds", label: "Sounds", icon: Volume2 },
  { id: "jobs", label: "Jobs", icon: ListTodo },
  { id: "ableton", label: "Ableton", icon: Cable },
] as const;

type TabId = (typeof TABS)[number]["id"];

function badgeVariant(state: string): "success" | "warning" | "danger" | "gold" | "muted" {
  const s = state.toUpperCase();
  if (["ONLINE", "READY", "CONNECTED", "HEALTHY", "PASS"].includes(s)) return "success";
  if (["BLOCKED", "UNKNOWN", "NOT_APPLICABLE"].includes(s)) return "gold";
  if (["NOT READY", "DISCONNECTED", "OFFLINE", "ERROR"].includes(s)) return "danger";
  return "muted";
}

function formatAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms ago`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s ago`;
  return `${Math.round(ms / 60_000)} min ago`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ServiceCard({ label, value, meta }: { label: string; value: string; meta?: string }) {
  const onlineish = ["ONLINE", "READY", "CONNECTED", "HEALTHY", "PASS"].includes(value.toUpperCase());
  return (
    <div className="hq-kpi-card">
      <div className="hq-kpi-label">{label}</div>
      <div className={`hq-kpi-value`} style={{ fontSize: "1.15rem" }}>
        <StatusBadge label={value} variant={badgeVariant(value)} pulse={onlineish} />
      </div>
      {meta ? <div className="hq-kpi-meta">{meta}</div> : null}
    </div>
  );
}

function FoundationPlaceholder({ title, note }: { title: string; note?: string }) {
  return (
    <HqPanel title={title} subtitle="UI foundation — full capability lands in later phases">
      <p style={{ color: "var(--hq-text-muted)", margin: 0, lineHeight: 1.5 }}>
        {note || "Architecture reserved."}
      </p>
    </HqPanel>
  );
}

function MixReviewPanel({ onDone }: { onDone: () => void }) {
  const reviewQuery = useQuery({
    queryKey: ["hq-aura-music-mix-review"],
    queryFn: () => hqApi.auraMusicMixReview(),
    refetchInterval: 12_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [abMode, setAbMode] = useState<"original" | "mix">("mix");
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null);
  const review = reviewQuery.data?.review;
  const jobId = review?.jobId;
  const revisionOptions = Array.from(
    new Set((review?.audio || []).map((a: { revision: string }) => a.revision))
  ) as string[];
  const revision = selectedRevision || review?.revision || revisionOptions[0] || "Mix V2";

  const originalUrl = jobId
    ? hqApi.auraMusicMixAudioUrl(jobId, revision, "original")
    : null;
  const mixUrl = jobId ? hqApi.auraMusicMixAudioUrl(jobId, revision, "mix") : null;
  const selectedReport =
    (review?.audio || []).find(
      (a: { revision: string; kind: string; report?: string | null }) =>
        a.revision === revision && a.kind === "mix" && a.report
    )?.report || review?.report;

  async function enqueue(command: string, args: Record<string, unknown>) {
    setBusy(command);
    setMessage("");
    try {
      const enq = await hqApi.auraMusicEnqueueCommand(command, {
        args,
        replayKey: `${command}-${Date.now()}`,
      });
      setMessage(`Queued ${command} → ${enq.id}`);
      onDone();
      reviewQuery.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <HqPanel title="Mixing Intelligence" subtitle="Phase 3 — Ableton engineering racks + audible Mix review">
        <p style={{ color: "var(--hq-text-muted)", margin: "0 0 1rem", lineHeight: 1.5 }}>
          Listen → Diagnose → Decide → Process → Re-analyze → Compare → Correct → Report.
          Approved racks only. DO_NOTHING is always valid.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
          {["AURA Vocal Rack", "AURA Drum Bus", "AURA Bass Control", "AURA Instrument Rack", "AURA Mix Bus"].map(
            (rack) => (
              <StatusBadge key={rack} label={rack} variant="gold" />
            )
          )}
        </div>
      </HqPanel>

      <HqPanel title="Audible Mix Review" subtitle={jobId ? `${jobId} · ${revision}` : "Waiting for Mix V2 upload from production node"}>
        {!jobId ? (
          <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>
            After Mix V2 completes on the Mac node, Original + Mix WAVs appear here for A/B listening.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
              {revisionOptions.map((rev) => (
                <button
                  key={rev}
                  type="button"
                  className="hq-btn"
                  onClick={() => setSelectedRevision(rev)}
                  style={
                    revision === rev
                      ? { outline: "2px solid var(--hq-gold, #c9a227)" }
                      : undefined
                  }
                >
                  {rev}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
              <button type="button" className="hq-btn" onClick={() => setAbMode("original")} disabled={!originalUrl}>
                Play Original
              </button>
              <button type="button" className="hq-btn" onClick={() => setAbMode("mix")} disabled={!mixUrl}>
                Play AURA {revision}
              </button>
              <button
                type="button"
                className="hq-btn"
                onClick={() => setAbMode(abMode === "original" ? "mix" : "original")}
              >
                A/B Compare ({abMode === "original" ? "Original" : revision})
              </button>
            </div>
            {(abMode === "original" ? originalUrl : mixUrl) ? (
              <audio
                key={`${abMode}-${revision}`}
                controls
                src={abMode === "original" ? originalUrl! : mixUrl!}
                style={{ width: "100%", marginBottom: "1rem" }}
              />
            ) : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
              <button
                type="button"
                className="hq-btn"
                disabled={!!busy}
                onClick={() =>
                  enqueue("mix_submit_feedback", {
                    jobId,
                    feedbackType: "approved",
                    comment: `Approved ${revision}`,
                  })
                }
              >
                Approve
              </button>
              <button
                type="button"
                className="hq-btn"
                disabled={!!busy}
                onClick={() =>
                  enqueue("mix_revise_job", {
                    jobId,
                    instruction: "Bring the vocal forward.",
                  })
                }
              >
                Request Revision
              </button>
              <button type="button" className="hq-btn" disabled={!!busy} onClick={() => reviewQuery.refetch()}>
                Refresh Review
              </button>
            </div>
            {message ? <p className="hq-kpi-meta">{message}</p> : null}

            <details open style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Engineering Report</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.75rem",
                  lineHeight: 1.45,
                  maxHeight: 360,
                  overflow: "auto",
                  marginTop: "0.75rem",
                  color: "var(--hq-text-muted)",
                }}
              >
                {selectedReport || "Report will appear after Mix V2 upload."}
              </pre>
            </details>
          </>
        )}
      </HqPanel>
    </div>
  );
}

const REMOTE_COMMANDS: { id: string; label: string }[] = [
  { id: "read_session", label: "Read Live Set / session" },
  { id: "read_tracks", label: "Read track list" },
  { id: "read_status", label: "Read bridge status" },
  { id: "transport_play", label: "Start playback" },
  { id: "transport_stop", label: "Stop playback" },
  { id: "mix_get_job", label: "Get mix job status (requires jobId in args)" },
  { id: "mix_run_job", label: "Run mix job on production node (requires jobId)" },
];

function RemoteCommandPanel({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string>("");
  const [enrollInfo, setEnrollInfo] = useState<string>("");
  const nodeStatus = useQuery({
    queryKey: ["hq-aura-music-node-status"],
    queryFn: () => hqApi.auraMusicNodeStatus(),
    refetchInterval: 10_000,
    retry: 0,
  });

  async function enroll() {
    setBusy("enroll");
    setEnrollInfo("");
    try {
      const res = await hqApi.auraMusicEnrollNode({ label: "Founder Mac Production Node" });
      setEnrollInfo(
        [
          "Node enrolled. Save this token on the Mac (shown once):",
          `AURA_MUSIC_HQ_BASE_URL=${res.hqBaseUrl || "https://ifcdc-hq-wst6.onrender.com"}`,
          `AURA_MUSIC_NODE_ID=${res.nodeId}`,
          `AURA_MUSIC_NODE_TOKEN=${res.token}`,
          "",
          "Write ~/Music/IFCDC-MUSIC/secrets/production-node.json then ensure LaunchAgent com.ifcdc.aura-music-production-node is running.",
        ].join("\n")
      );
      await nodeStatus.refetch();
      onDone();
    } catch (e) {
      setEnrollInfo(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runCommand(command: string) {
    setBusy(command);
    setLastResult("");
    try {
      const enq = await hqApi.auraMusicEnqueueCommand(command);
      const started = Date.now();
      let finalStatus = enq.status;
      let result: unknown = null;
      let error: string | null = null;
      while (Date.now() - started < 45_000) {
        await new Promise((r) => setTimeout(r, 1500));
        const look = await hqApi.auraMusicGetCommand(enq.id);
        finalStatus = look.command.status;
        result = look.command.result;
        error = look.command.error ?? null;
        if (finalStatus === "succeeded" || finalStatus === "failed") break;
      }
      setLastResult(
        JSON.stringify(
          {
            id: enq.id,
            command,
            status: finalStatus,
            error,
            result,
          },
          null,
          2
        )
      );
      await nodeStatus.refetch();
      onDone();
    } catch (e) {
      setLastResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const node = nodeStatus.data?.node;

  return (
    <HqPanel
      title="Remote production commands"
      subtitle="Allowlisted Ableton reads/transport via Mac outbound agent — no public ports"
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center" }}>
        <StatusBadge
          label={node?.online ? "NODE ONLINE" : "NODE OFFLINE"}
          variant={node?.online ? "success" : "danger"}
          pulse={Boolean(node?.online)}
        />
        {node?.nodeId ? <span className="hq-kpi-meta">Node {node.nodeId}</span> : null}
        {node?.lastSeenAt ? (
          <span className="hq-kpi-meta">Last seen {new Date(node.lastSeenAt).toLocaleString()}</span>
        ) : null}
        <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={busy === "enroll"} onClick={() => void enroll()}>
          Enroll Mac node
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {REMOTE_COMMANDS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="hq-btn hq-btn-secondary hq-btn-sm"
            disabled={Boolean(busy) || !node?.online}
            onClick={() => void runCommand(c.id)}
          >
            {busy === c.id ? "Running…" : c.label}
          </button>
        ))}
      </div>
      {enrollInfo ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: "0.72rem",
            background: "rgba(0,0,0,0.35)",
            padding: "0.75rem",
            borderRadius: 8,
            overflow: "auto",
          }}
        >
          {enrollInfo}
        </pre>
      ) : null}
      {lastResult ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: "0.72rem",
            background: "rgba(0,0,0,0.35)",
            padding: "0.75rem",
            borderRadius: 8,
            overflow: "auto",
            maxHeight: 280,
          }}
        >
          {lastResult}
        </pre>
      ) : (
        <p className="hq-kpi-meta" style={{ margin: 0 }}>
          Harmless remote tests: session name, tracks, play/stop. Destructive commands are not allowlisted.
        </p>
      )}
    </HqPanel>
  );
}

const AuraMusicCommandCenterPage: React.FC = () => {
  const [tab, setTab] = useState<TabId>("dashboard");

  const query = useQuery({
    queryKey: ["hq-aura-music-command-center"],
    queryFn: () => hqApi.auraMusicCommandCenter(),
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: 1,
  });

  const data: AuraMusicCommandCenter | undefined = query.data;
  const services = data?.services;
  const sectionMeta = useMemo(() => {
    const map = new Map((data?.sections ?? []).map((s) => [s.id, s]));
    return map;
  }, [data?.sections]);

  return (
    <HQLayout
      title="AURA MUSIC"
      subtitle="HQ music production command center — monitor the local production node securely"
      auraModule="aura"
      auraActions={["ask", "summarize"]}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <StatusBadge
          label={data?.auraMusicReady ? "AURA MUSIC READY" : "PRODUCTION NODE NOT READY"}
          variant={data?.auraMusicReady ? "success" : "warning"}
          pulse={Boolean(data?.auraMusicReady)}
        />
        <StatusBadge label={`Phase ${data?.currentPhase ?? "2"}`} variant="gold" />
        <StatusBadge label={data?.mode === "cloud_hq" ? "Cloud HQ" : "Local node linked"} variant="muted" />
        <button
          type="button"
          className="hq-btn hq-btn-secondary hq-btn-sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          style={{ marginLeft: "auto" }}
        >
          <RefreshCw size={14} className={query.isFetching ? "hq-spin" : undefined} />
          Refresh
        </button>
      </div>

      {data?.message ? (
        <div
          className="hq-panel"
          style={{ marginBottom: "1rem", borderColor: "rgba(245,158,11,0.35)" }}
        >
          <div className="hq-panel-body" style={{ padding: "0.9rem 1.1rem", color: "var(--hq-warning)", fontSize: "0.85rem" }}>
            {data.message}
          </div>
        </div>
      ) : null}

      <div className="hq-tabs" role="tablist" aria-label="AURA MUSIC sections">
        {TABS.map(({ id, label, icon: Icon }) => {
          const meta = sectionMeta.get(id);
          const locked = meta ? meta.available === false : ["mix", "master", "sampling", "sounds"].includes(id);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`hq-tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              {label}
              {locked ? <span className="hq-badge muted" style={{ marginLeft: 4 }}>Soon</span> : null}
            </button>
          );
        })}
      </div>

      <HqQueryBoundary
        query={query}
        hasRenderableData={Boolean(data)}
        title="AURA MUSIC unavailable"
        loadingMessage="Loading AURA MUSIC Command Center…"
      >
        {tab === "dashboard" && data && (
          <>
            <div className="hq-kpi-grid">
              <ServiceCard label="Music Intelligence" value={services?.musicIntelligence ?? "OFFLINE"} />
              <ServiceCard label="Ableton Bridge" value={services?.abletonBridge ?? "OFFLINE"} />
              <ServiceCard label="Ableton Live" value={services?.abletonLive ?? "DISCONNECTED"} />
              <ServiceCard label="Production Node" value={services?.productionNode ?? "NOT READY"} />
              <ServiceCard label="Watchdog" value={services?.watchdog ?? "ERROR"} />
              <ServiceCard
                label="Last Heartbeat"
                value={data.lastHeartbeatAt ? "LIVE" : "NONE"}
                meta={
                  data.lastHeartbeatAt
                    ? `${new Date(data.lastHeartbeatAt).toLocaleString()} · ${formatAge(data.lastHeartbeatAgeMs)}`
                    : "No heartbeat from production node"
                }
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <HqPanel title="Phase status" subtitle="Roadmap gates — Phase 3 mixing intelligence active">
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                  {(
                    [
                      ["Phase 1", data.phases.phase1],
                      ["Phase 2", data.phases.phase2],
                      ["Phase 2 Hardening", data.phases.phase2Hardening],
                      ["Phase 3", data.phases.phase3],
                    ] as const
                  ).map(([name, phase]) => (
                    <li key={name} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 650 }}>{name}</div>
                        <div className="hq-kpi-meta">{phase.label}</div>
                      </div>
                      <StatusBadge label={phase.status} variant={badgeVariant(phase.status)} />
                    </li>
                  ))}
                </ul>
              </HqPanel>

              <HqPanel title="Current job" subtitle="Secure Music Job Queue">
                {data.currentJob ? (
                  <div>
                    <div style={{ fontWeight: 700 }}>{data.currentJob.title}</div>
                    <div className="hq-kpi-meta">{data.currentJob.id} · {data.currentJob.status}</div>
                    {data.currentJob.detail ? <p style={{ marginTop: "0.75rem" }}>{data.currentJob.detail}</p> : null}
                  </div>
                ) : (
                  <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>No active job. Queue is idle.</p>
                )}
              </HqPanel>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
              <HqPanel title="Job queue" subtitle={`${data.jobQueue.length} queued`}>
                {data.jobQueue.length === 0 ? (
                  <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>Queue empty — foundation ready for Phase 3+ jobs.</p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {data.jobQueue.map((j) => (
                      <li key={j.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <strong>{j.title}</strong>
                        <div className="hq-kpi-meta">{j.status} · {j.id}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </HqPanel>

              <HqPanel title="Recent exports" subtitle="Production node library exports">
                {data.recentExports.length === 0 ? (
                  <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>No exports visible from this HQ host.</p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {data.recentExports.map((ex) => (
                      <li key={ex.path} style={{ padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <strong>{ex.name}</strong>
                        <div className="hq-kpi-meta">
                          {formatBytes(ex.sizeBytes)} · {new Date(ex.modifiedAt).toLocaleString()}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </HqPanel>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <HqPanel title="Architecture" subtitle="Locked production path">
                <p style={{ margin: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.8rem", color: "var(--hq-gold)" }}>
                  {data.architecture}
                </p>
                <p className="hq-kpi-meta" style={{ marginTop: "0.75rem" }}>
                  Ports 4177 / 4178 remain private on the Founder Mac. Authorized devices use IFCDC HQ only.
                  {data.mode === "remote_production_node" ? ` · Linked node ${data.nodeId ?? ""}` : ""}
                  {data.statusGeneratedAt ? ` · Status ${new Date(data.statusGeneratedAt).toLocaleString()}` : ""}
                </p>
              </HqPanel>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <RemoteCommandPanel onDone={() => query.refetch()} />
            </div>
          </>
        )}

        {tab === "library" && (
          <FoundationPlaceholder
            title="Music Library"
            note={sectionMeta.get("library")?.note || "Phase 2 intelligence library (ingest, rights, search) runs on the production node. HQ browse UX expands here without exposing localhost ports."}
          />
        )}
        {tab === "projects" && (
          <FoundationPlaceholder
            title="Projects"
            note={sectionMeta.get("projects")?.note || "MUSIC-###### project records will surface here from the Secure Music Job Queue."}
          />
        )}
        {tab === "mix" && data && <MixReviewPanel onDone={() => query.refetch()} />}
        {tab === "master" && <FoundationPlaceholder title="Master" note="Phase 4 mastering + QC — not started." />}
        {tab === "sampling" && <FoundationPlaceholder title="Sampling" note="Sampling workspace reserved." />}
        {tab === "sounds" && <FoundationPlaceholder title="Sounds" note="Sound / instrument browser reserved." />}
        {tab === "jobs" && data && (
          <HqPanel title="Secure Music Job Queue" subtitle="Foundation">
            {data.currentJob || data.jobQueue.length > 0 ? (
              <div>
                {data.currentJob ? (
                  <div style={{ marginBottom: "1rem" }}>
                    <StatusBadge label="CURRENT" variant="gold" />
                    <div style={{ fontWeight: 700, marginTop: "0.5rem" }}>{data.currentJob.title}</div>
                  </div>
                ) : null}
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {data.jobQueue.map((j) => (
                    <li key={j.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {j.title} · {j.status}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>
                No jobs queued. This is the HQ-facing queue surface for future AURA MUSIC production jobs.
              </p>
            )}
          </HqPanel>
        )}
        {tab === "ableton" && data && (
          <div className="hq-kpi-grid">
            <ServiceCard label="Ableton Bridge" value={services?.abletonBridge ?? "OFFLINE"} />
            <ServiceCard label="Ableton Live" value={services?.abletonLive ?? "DISCONNECTED"} />
            <ServiceCard label="Production Node" value={services?.productionNode ?? "NOT READY"} />
            <ServiceCard
              label="Heartbeat"
              value={data.lastHeartbeatAt ? "FRESH" : "MISSING"}
              meta={data.lastHeartbeatAt ? formatAge(data.lastHeartbeatAgeMs) : undefined}
            />
          </div>
        )}
      </HqQueryBoundary>

      <div style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--hq-text-dim)", fontSize: "0.75rem" }}>
        <Music2 size={14} />
        <span>AURA MUSIC is an IFCDC HQ module — Phase 3 mixing intelligence active. Mastering, DJ mode, and publishing remain blocked.</span>
        <Radio size={14} style={{ marginLeft: "auto", opacity: 0.5 }} />
      </div>
    </HQLayout>
  );
};

export default AuraMusicCommandCenterPage;
