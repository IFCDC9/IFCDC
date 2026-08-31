/**
 * AURA MUSIC Command Center — IFCDC HQ module.
 * Phase 3 controlled mixing intelligence enabled (engineering racks, Mix V1).
 */
import React, { useMemo, useRef, useState } from "react";
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
  ListTodo,
  Cable,
  LayoutDashboard,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi, type AuraMusicCommandCenter } from "../../api/hqApi";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqQueryBoundary } from "../../components/hq/HqQueryBoundary";

const PRIMARY_TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "library", label: "Library", icon: Library },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "mix", label: "Mix", icon: SlidersHorizontal },
  { id: "sampling", label: "Sampling", icon: AudioWaveform },
  { id: "master", label: "Master", icon: Disc3 },
] as const;

const SECONDARY_TABS = [
  { id: "jobs", label: "Jobs", icon: ListTodo },
  { id: "ableton", label: "Ableton", icon: Cable },
] as const;

const TABS = [...PRIMARY_TABS, ...SECONDARY_TABS] as const;

type TabId = (typeof TABS)[number]["id"];

function badgeVariant(state: string): "success" | "warning" | "danger" | "gold" | "muted" {
  const s = state.toUpperCase();
  if (["ONLINE", "READY", "CONNECTED", "HEALTHY", "PASS", "COMPLETE", "ACTIVE"].includes(s)) return "success";
  if (["RECONNECTING", "RECOVERING"].includes(s)) return "warning";
  if (["BLOCKED", "UNKNOWN", "NOT_APPLICABLE"].includes(s)) return "gold";
  if (["NOT READY", "DISCONNECTED", "OFFLINE", "ERROR", "DEGRADED"].includes(s)) return "danger";
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
  const onlineish = ["ONLINE", "READY", "CONNECTED", "HEALTHY", "PASS", "RECONNECTING"].includes(value.toUpperCase());
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
  const [playbackError, setPlaybackError] = useState("");
  const [abMode, setAbMode] = useState<"original" | "mix">("mix");
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const review = reviewQuery.data?.review;
  const jobId = review?.jobId;
  const audioItems = (review?.audio || []) as Array<{
    revision: string;
    kind: string;
    bytes: number;
    url: string;
    playable?: boolean;
    mimeType?: string;
    report?: string | null;
  }>;
  const revisionOptions = Array.from(new Set(audioItems.map((a) => a.revision)));
  const revision = selectedRevision || review?.revision || revisionOptions[0] || "Mix V2";

  // Resolve playable URLs from server inventory — original may live under a different revision label
  const mixItem =
    audioItems.find((a) => a.revision === revision && a.kind === "mix" && a.playable !== false) ||
    audioItems.find((a) => a.revision === revision && a.kind === "mix") ||
    audioItems.find((a) => a.kind === "mix" && a.playable !== false) ||
    null;
  const originalItem =
    audioItems.find((a) => a.kind === "original" && a.playable !== false) ||
    audioItems.find((a) => a.kind === "original") ||
    null;

  const mixUrl = mixItem?.url || review?.mixUrl || null;
  const originalUrl = originalItem?.url || review?.originalUrl || null;
  const activeUrl = abMode === "original" ? originalUrl : mixUrl;
  const activeMeta = abMode === "original" ? originalItem : mixItem;

  const selectedReport =
    audioItems.find((a) => a.revision === revision && a.kind === "mix" && a.report)?.report ||
    review?.report;

  async function playUrl(url: string, label: string, mode: "original" | "mix") {
    setAbMode(mode);
    setPlaybackError("");
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-1" },
        credentials: "include",
      });
      if (!res.ok) {
        setPlaybackError(`${label} failed HTTP ${res.status}`);
        return;
      }
      // Wait a tick so React applies the new src from abMode, then play
      requestAnimationFrame(() => {
        const el = audioRef.current;
        if (!el) {
          setPlaybackError(`${label}: audio element missing`);
          return;
        }
        el.src = url;
        void el
          .play()
          .then(() => setPlaybackError(""))
          .catch((err) => {
            setPlaybackError(`${label} play blocked: ${err instanceof Error ? err.message : String(err)}`);
          });
      });
    } catch (err) {
      setPlaybackError(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
                  onClick={() => {
                    setSelectedRevision(rev);
                    setPlaybackError("");
                  }}
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
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                onClick={() => originalUrl && void playUrl(originalUrl, "Play Original", "original")}
                disabled={!originalUrl}
              >
                Play Original
              </button>
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                onClick={() => mixUrl && void playUrl(mixUrl, `Play AURA ${revision}`, "mix")}
                disabled={!mixUrl}
              >
                Play AURA {revision}
              </button>
              <button
                type="button"
                className="hq-btn"
                onClick={() => {
                  const next = abMode === "original" ? "mix" : "original";
                  const url = next === "original" ? originalUrl : mixUrl;
                  if (url) void playUrl(url, `A/B ${next}`, next);
                }}
                disabled={!originalUrl && !mixUrl}
              >
                A/B Compare ({abMode === "original" ? "Original" : revision})
              </button>
            </div>
            {activeUrl ? (
              <audio
                ref={audioRef}
                key={`${abMode}-${activeUrl}`}
                controls
                preload="metadata"
                src={activeUrl}
                style={{ width: "100%", marginBottom: "0.5rem" }}
                onError={(e) => {
                  const el = e.currentTarget;
                  setPlaybackError(
                    `Player error (${abMode}) · code=${el.error?.code ?? "?"} · ${activeUrl}`
                  );
                }}
                onLoadedMetadata={() => setPlaybackError("")}
              />
            ) : (
              <p style={{ color: "var(--hq-danger, #c44)", margin: "0 0 1rem" }}>
                No playable {abMode} URL for this job. Refresh or re-upload from the production node.
              </p>
            )}
            {playbackError ? (
              <p className="hq-kpi-meta" style={{ color: "var(--hq-danger, #c44)", marginBottom: "1rem" }}>
                {playbackError}
              </p>
            ) : null}
            {activeMeta ? (
              <p className="hq-kpi-meta" style={{ marginBottom: "1rem" }}>
                {abMode}: {activeMeta.bytes?.toLocaleString?.() || activeMeta.bytes} bytes ·{" "}
                {activeMeta.mimeType || "audio/wav"} · {activeUrl}
              </p>
            ) : null}

            <HqPanel title="Review Controls" subtitle="Founder decision actions for the selected mix">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.5rem" }}>
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
            </HqPanel>

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

function MusicLibraryPanel() {
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const libQuery = useQuery({
    queryKey: ["hq-aura-music-mix-library", showArchived],
    queryFn: () => hqApi.auraMusicMixLibrary(showArchived),
    refetchInterval: 15_000,
  });
  const assets = libQuery.data?.assets || [];

  async function playAsset(url: string) {
    setMsg("");
    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    try {
      await el.play();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function archiveAsset(id: string) {
    setBusyId(id);
    setMsg("");
    try {
      await hqApi.auraMusicMixArchive(id);
      await libQuery.refetch();
      setMsg("Archived.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAsset(id: string) {
    if (!window.confirm("Permanently delete this mix asset from HQ storage?")) return;
    setBusyId(id);
    setMsg("");
    try {
      await hqApi.auraMusicMixDelete(id);
      await libQuery.refetch();
      setMsg("Deleted.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <HqQueryBoundary
      query={libQuery}
      hasRenderableData={Boolean(libQuery.data)}
      title="Music Library unavailable"
      loadingMessage="Loading HQ mix library…"
    >
      <HqPanel
        title="Music Library"
        subtitle="HQ mix inventory — playback, archive, and delete (persistent Render disk)"
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
          <button
            type="button"
            className={`hq-btn hq-btn-sm ${!showArchived ? "hq-btn-primary" : "hq-btn-secondary"}`}
            onClick={() => setShowArchived(false)}
          >
            Active
          </button>
          <button
            type="button"
            className={`hq-btn hq-btn-sm ${showArchived ? "hq-btn-primary" : "hq-btn-secondary"}`}
            onClick={() => setShowArchived(true)}
          >
            Include archived
          </button>
          <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => libQuery.refetch()}>
            Refresh
          </button>
          <span className="hq-kpi-meta">{assets.length} assets</span>
        </div>
        <audio ref={audioRef} controls preload="metadata" style={{ width: "100%", marginBottom: "1rem" }} />
        {msg ? <p className="hq-kpi-meta" style={{ marginBottom: "0.75rem" }}>{msg}</p> : null}
        {assets.length === 0 ? (
          <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>No mix assets on this HQ host yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {assets.map((a) => (
              <li
                key={a.id}
                style={{
                  padding: "0.7rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  display: "grid",
                  gap: "0.35rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <strong>
                      {a.jobId} · {a.revision} · {a.kind}
                    </strong>
                    <div className="hq-kpi-meta">
                      {formatBytes(a.bytes)} · {a.createdAt ? new Date(a.createdAt).toLocaleString() : "—"}
                      {a.archivedAt ? ` · archived ${new Date(a.archivedAt).toLocaleString()}` : ""}
                      {a.playable ? " · playable" : " · missing file"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="hq-btn hq-btn-sm hq-btn-primary"
                      disabled={!a.playable || busyId === a.id}
                      onClick={() => void playAsset(a.url)}
                    >
                      Play
                    </button>
                    {!a.archivedAt ? (
                      <button
                        type="button"
                        className="hq-btn hq-btn-sm"
                        disabled={busyId === a.id}
                        onClick={() => void archiveAsset(a.id)}
                      >
                        Archive
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="hq-btn hq-btn-sm"
                      disabled={busyId === a.id}
                      onClick={() => void deleteAsset(a.id)}
                      style={{ color: "var(--hq-danger, #c44)" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </HqPanel>
    </HqQueryBoundary>
  );
}

function MasterReviewPanel({ onDone }: { onDone: () => void }) {
  const reviewQuery = useQuery({
    queryKey: ["hq-aura-music-master-review"],
    queryFn: () => hqApi.auraMusicMasterReview(),
    refetchInterval: 12_000,
  });
  const libraryQuery = useQuery({
    queryKey: ["hq-aura-music-master-library"],
    queryFn: () => hqApi.auraMusicMasterLibrary(false),
    refetchInterval: 20_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [selected, setSelected] = useState<"premaster" | "A" | "B" | "C">("B");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const review = reviewQuery.data?.review;

  const urlMap = {
    premaster: review?.premasterUrl || null,
    A: review?.masterAUrl || null,
    B: review?.masterBUrl || null,
    C: review?.masterCUrl || null,
  } as const;
  const labelMap = {
    premaster: "Play Premaster",
    A: "Master A — Dynamic",
    B: "Master B — Competitive",
    C: "Master C — Platform-safe",
  } as const;
  const activeUrl = urlMap[selected];

  async function playSelection(key: typeof selected) {
    setSelected(key);
    setPlaybackError("");
    const url = urlMap[key];
    if (!url) {
      setPlaybackError(`${labelMap[key]} not available yet`);
      return;
    }
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-1" },
        credentials: "include",
      });
      if (!res.ok) {
        setPlaybackError(`${labelMap[key]} failed HTTP ${res.status}`);
        return;
      }
      requestAnimationFrame(() => {
        const el = audioRef.current;
        if (!el) {
          setPlaybackError("audio element missing");
          return;
        }
        el.src = url;
        void el
          .play()
          .then(() => setPlaybackError(""))
          .catch((err) => {
            setPlaybackError(`play blocked: ${err instanceof Error ? err.message : String(err)}`);
          });
      });
    } catch (err) {
      setPlaybackError(err instanceof Error ? err.message : String(err));
    }
  }

  async function archiveAsset(id: string) {
    setBusy(id);
    try {
      await hqApi.auraMusicMasterArchive(id);
      setMessage("Archived audition master");
      libraryQuery.refetch();
      reviewQuery.refetch();
      onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAsset(id: string) {
    if (!window.confirm("Permanently delete this audition master?")) return;
    setBusy(id);
    try {
      await hqApi.auraMusicMasterDelete(id);
      setMessage("Deleted audition master");
      libraryQuery.refetch();
      reviewQuery.refetch();
      onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <HqPanel title="AURA Mastering Engine" subtitle="Stereo-program mastering — validation lineage only">
        <p style={{ color: "var(--hq-text-muted)", margin: "0 0 0.75rem", lineHeight: 1.5 }}>
          Listen → Analyze → Diagnose → Decide → Process → Re-analyze → A/B → Translate → Keep / Modify / Remove.
          DO NOTHING is always valid. Mix problems must RETURN TO MIX — not be hidden by limiting.
        </p>
        <StatusBadge
          label={review?.validationLabel || "VALIDATION MASTER — FINAL HUMAN VOCAL STILL REQUIRED"}
          variant="warning"
        />
      </HqPanel>

      <HqPanel
        title="Master Workspace"
        subtitle={review?.jobId ? `${review.jobId} · Premaster → Master A/B/C` : "Waiting for premaster / master uploads"}
      >
        {!review?.jobId ? (
          <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>
            After the mastering pipeline runs on the production node, Premaster + Master A/B/C appear here.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
              {(["premaster", "A", "B", "C"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={selected === key ? "hq-btn hq-btn-primary" : "hq-btn"}
                  onClick={() => void playSelection(key)}
                  disabled={!urlMap[key]}
                >
                  {labelMap[key]}
                </button>
              ))}
              <button
                type="button"
                className="hq-btn"
                onClick={() => {
                  const next = selected === "premaster" ? "B" : selected === "B" ? "A" : selected === "A" ? "C" : "premaster";
                  void playSelection(next);
                }}
                disabled={!urlMap.premaster && !urlMap.B}
              >
                Loudness-Aware A/B
              </button>
            </div>
            {activeUrl ? (
              <audio
                ref={audioRef}
                key={`${selected}-${activeUrl}`}
                controls
                preload="metadata"
                src={activeUrl}
                style={{ width: "100%", marginBottom: "0.5rem" }}
                onError={() => setPlaybackError(`Player error · ${activeUrl}`)}
              />
            ) : (
              <p style={{ color: "var(--hq-danger, #c44)", margin: "0 0 1rem" }}>No playable URL for {labelMap[selected]}.</p>
            )}
            {playbackError ? (
              <p className="hq-kpi-meta" style={{ color: "var(--hq-danger, #c44)", marginBottom: "1rem" }}>
                {playbackError}
              </p>
            ) : null}
            {review.report ? (
              <details style={{ marginTop: "0.5rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Mastering Report</summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: "0.78rem",
                    color: "var(--hq-text-muted)",
                    maxHeight: 360,
                    overflow: "auto",
                  }}
                >
                  {review.report}
                </pre>
              </details>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" disabled>
                Approve (validation only)
              </button>
              <button type="button" className="hq-btn" disabled={busy != null}>
                Request Revision
              </button>
            </div>
            <p className="hq-kpi-meta" style={{ marginTop: "0.75rem" }}>
              Commercial FINAL MASTER is blocked until cleared human vocal replaces AURA_INTERNAL_VALIDATION_PLACEHOLDER.
            </p>
          </>
        )}
        {message ? <p className="hq-kpi-meta">{message}</p> : null}
      </HqPanel>

      <HqPanel title="Master Library Cleanup" subtitle="Archive or delete audition masters">
        {(libraryQuery.data?.assets || []).length === 0 ? (
          <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>No mastering auditions in library yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {(libraryQuery.data?.assets || []).map((asset) => (
              <li
                key={asset.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center",
                  padding: "0.65rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 600 }}>{asset.revision}</div>
                  <div className="hq-kpi-meta">
                    {asset.kind} · {asset.bytes.toLocaleString()} bytes · {asset.playable ? "playable" : "missing"}
                  </div>
                </div>
                <button type="button" className="hq-btn" disabled={busy === asset.id} onClick={() => void archiveAsset(asset.id)}>
                  Archive
                </button>
                <button type="button" className="hq-btn" disabled={busy === asset.id} onClick={() => void deleteAsset(asset.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </HqPanel>
    </div>
  );
}

function tabBadge(meta: { status?: string; available?: boolean } | undefined): string | null {
  if (!meta) return null;
  if (meta.status === "SOON" || (meta.available === false && meta.status !== "ACTIVE" && meta.status !== "COMPLETE")) {
    return "Soon";
  }
  if (meta.status === "COMPLETE") return "Complete";
  return null;
}

function productionNodeBanner(productionNode: string | undefined): { label: string; variant: "success" | "warning" | "danger" | "gold" | "muted"; pulse: boolean } {
  const state = String(productionNode || "NOT READY").toUpperCase();
  if (state === "READY") return { label: "PRODUCTION NODE READY", variant: "success", pulse: true };
  if (state === "RECONNECTING") return { label: "PRODUCTION NODE RECONNECTING", variant: "warning", pulse: true };
  if (state === "OFFLINE") return { label: "PRODUCTION NODE OFFLINE", variant: "danger", pulse: false };
  if (state === "ERROR") return { label: "PRODUCTION NODE ERROR", variant: "danger", pulse: false };
  return { label: "PRODUCTION NODE NOT READY", variant: "warning", pulse: false };
}

function ModuleStatusPanel({ modules }: { modules: NonNullable<AuraMusicCommandCenter["modules"]> }) {
  const rows = [
    { name: "Mixing Intelligence", ...modules.mixingIntelligence },
    { name: "Sampling Mastery", ...modules.samplingMastery },
    { name: "Vocal Production Gate", ...modules.vocalProductionGate },
    { name: "Mastering Engine", ...modules.masteringEngine },
  ];
  const mastery = modules.abletonMastery;
  return (
    <HqPanel title="AURA module state" subtitle="Backend-driven capability status">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {rows.map((row) => (
          <li key={row.name} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 650 }}>{row.name}</div>
              <div className="hq-kpi-meta">{row.label}</div>
            </div>
            <StatusBadge label={row.status} variant={badgeVariant(row.status)} />
          </li>
        ))}
      </ul>
      <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="hq-kpi-meta">Overall Ableton Mastery</div>
        <div style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--hq-gold)" }}>
          {mastery.overallPercent != null ? `${mastery.overallPercent}%` : "—"}
        </div>
        <div className="hq-kpi-meta" style={{ marginTop: "0.35rem" }}>
          Level 7 {mastery.level7Complete ? "complete" : "in progress"} · Level 9 {mastery.level9Complete ? "complete" : "pending"}
        </div>
      </div>
    </HqPanel>
  );
}

function SamplingPanel() {
  const samplingQuery = useQuery({
    queryKey: ["hq-aura-music-sampling"],
    queryFn: () => hqApi.auraMusicSampling(),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  const [areaId, setAreaId] = useState<string>("sample-library");
  const ws = samplingQuery.data;

  return (
    <HqQueryBoundary
      query={samplingQuery}
      hasRenderableData={Boolean(ws)}
      title="Sampling workspace unavailable"
      loadingMessage="Loading IFCDC Music Library sampling workspace…"
    >
      {ws && (
        <>
          <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
            <ServiceCard
              label="Level 7 Sampling"
              value={ws.level7.complete ? "COMPLETE" : "ACTIVE"}
              meta={`${ws.level7.mastered}/${ws.level7.total} mastered`}
            />
            <ServiceCard
              label="Overall Mastery"
              value={ws.overallMasteryPercent != null ? `${ws.overallMasteryPercent}%` : "—"}
            />
            <ServiceCard
              label="Hard Street Soul Catalog"
              value={String(ws.hardStreetSoul.catalogAssets)}
              meta={ws.hardStreetSoul.categories.length ? ws.hardStreetSoul.categories.join(", ") : "No catalog categories"}
            />
            <ServiceCard label="Rights Records" value={String(ws.rightsRecords.length)} meta="sample-rights metadata" />
          </div>

          {ws.message ? (
            <div className="hq-panel" style={{ marginBottom: "1rem", borderColor: "rgba(245,158,11,0.35)" }}>
              <div className="hq-panel-body" style={{ padding: "0.9rem 1.1rem", color: "var(--hq-warning)", fontSize: "0.85rem" }}>
                {ws.message}
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            {ws.areas.map((area) => (
              <button
                key={area.id}
                type="button"
                className={`hq-btn hq-btn-sm ${areaId === area.id ? "hq-btn-primary" : "hq-btn-secondary"}`}
                onClick={() => setAreaId(area.id)}
              >
                {area.label} ({area.count})
              </button>
            ))}
            <button
              type="button"
              className={`hq-btn hq-btn-sm ${areaId === "rights" ? "hq-btn-primary" : "hq-btn-secondary"}`}
              onClick={() => setAreaId("rights")}
            >
              Rights / License Metadata ({ws.rightsRecords.length})
            </button>
          </div>

          {areaId === "rights" ? (
            <HqPanel title="Rights / License Metadata" subtitle="Real sample-rights records from IFCDC Music Library">
              {ws.rightsRecords.length === 0 ? (
                <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>No rights records found on this host.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {ws.rightsRecords.map((r) => (
                    <li key={r.id} style={{ padding: "0.55rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <strong>{r.id}</strong>
                      <div className="hq-kpi-meta">
                        {r.sourceType || "unknown source"} · {r.authorized ? "authorized" : "pending"} · {r.production || "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </HqPanel>
          ) : (
            <HqPanel
              title={ws.areas.find((a) => a.id === areaId)?.label || "Sample Library"}
              subtitle="Real assets from AURA / IFCDC Music Library — no demo content"
            >
              {(() => {
                const area = ws.areas.find((a) => a.id === areaId);
                if (!area || area.assets.length === 0) {
                  return <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>No assets in this category on this host.</p>;
                }
                return (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {area.assets.map((asset) => (
                      <li key={asset.path} style={{ padding: "0.55rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <strong>{asset.name}</strong>
                        <div className="hq-kpi-meta">
                          {formatBytes(asset.sizeBytes)} · {new Date(asset.modifiedAt).toLocaleString()}
                          {asset.rightsId ? ` · rights: ${asset.rightsId}` : ""}
                          {asset.sourceType ? ` · ${asset.sourceType}` : ""}
                        </div>
                        <div className="hq-kpi-meta" style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.72rem", opacity: 0.75 }}>
                          {asset.path}
                        </div>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </HqPanel>
          )}

          {ws.level7.gate ? (
            <p className="hq-kpi-meta" style={{ marginTop: "1rem" }}>
              {ws.level7.gate}
            </p>
          ) : null}
        </>
      )}
    </HqQueryBoundary>
  );
}

function AbletonMasteryPanel({ onDone }: { onDone: () => void }) {
  const masteryQuery = useQuery({
    queryKey: ["hq-aura-music-mastery"],
    queryFn: () => hqApi.auraMusicMastery(),
    refetchInterval: 12_000,
  });
  const mixQuery = useQuery({
    queryKey: ["hq-aura-music-mix-review-mastery"],
    queryFn: () => hqApi.auraMusicMixReview(),
    refetchInterval: 12_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const mastery = masteryQuery.data?.mastery as Record<string, any> | null;
  const lastVal = masteryQuery.data?.lastValidation as Record<string, any> | null;
  const dash = (lastVal?.result as Record<string, any>) || mastery || {};
  const percent =
    typeof dash.overallMasteryPercent === "number"
      ? dash.overallMasteryPercent
      : masteryQuery.data?.overallMasteryPercent ?? 0;
  const levels = (dash.levels || dash.dashboard?.levels || {}) as Record<
    string,
    { name?: string; mastered?: number; total?: number; percent?: number; complete?: boolean }
  >;
  const counts = (dash.counts || dash.dashboard?.counts || {}) as Record<string, number>;
  const capabilities = (dash.capabilities || dash.dashboard?.capabilities || []) as Array<{
    id: string;
    name: string;
    level: number;
    status: string;
  }>;
  const recentlyMastered = (dash.recentlyMastered || dash.dashboard?.recentlyMastered || []) as Array<{
    name: string;
    level: number;
  }>;
  const inventory = (dash.inventory || dash.dashboard?.inventory || {}) as {
    instruments?: string[];
    packs?: string[];
  };
  const gate =
    dash.gateMessage ||
    (dash.levels1to3AllMastered || dash.levels1to3Complete
      ? "AURA ABLETON MASTERY — LEVELS 1–3 — ALL CHECKS PASSED"
      : null);

  const demoAudio = (mixQuery.data?.review?.audio || []).find(
    (a: { revision: string; kind: string }) =>
      /mastery/i.test(a.revision) && a.kind === "mix"
  );
  const demoJobId = mixQuery.data?.review?.jobId;
  const demoUrl =
    demoJobId && demoAudio
      ? hqApi.auraMusicMixAudioUrl(demoJobId, demoAudio.revision, "mix")
      : dash.jobId
        ? hqApi.auraMusicMixAudioUrl(String(dash.jobId), "Mastery L1-3 Demo", "mix")
        : null;

  async function runValidation() {
    setBusy("validate");
    setMessage("");
    try {
      const enq = await hqApi.auraMusicEnqueueCommand("mastery_validate_l1_l3", {
        replayKey: `mastery-l13-${Date.now()}`,
      });
      setMessage(`Queued mastery_validate_l1_l3 → ${enq.id} (runs on Mac; may take several minutes)`);
      const started = Date.now();
      while (Date.now() - started < 600_000) {
        await new Promise((r) => setTimeout(r, 4000));
        const look = await hqApi.auraMusicGetCommand(enq.id);
        if (look.command.status === "succeeded" || look.command.status === "failed") {
          setMessage(
            look.command.status === "succeeded"
              ? String((look.command.result as any)?.gateMessage || (look.command.result as any)?.result?.gateMessage || "Validation finished")
              : `Validation failed: ${look.command.error || "unknown"}`
          );
          break;
        }
      }
      await masteryQuery.refetch();
      await mixQuery.refetch();
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function refreshDashboard() {
    setBusy("dashboard");
    try {
      await hqApi.auraMusicEnqueueCommand("mastery_dashboard", {
        replayKey: `mastery-dash-${Date.now()}`,
      });
      await new Promise((r) => setTimeout(r, 5000));
      await masteryQuery.refetch();
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const statusColor = (s: string) => {
    if (s === "MASTERED") return "var(--hq-success, #3d9a6a)";
    if (s === "VALIDATED") return "var(--hq-gold, #c9a227)";
    if (s === "VALIDATION_REQUIRED") return "#c47a2c";
    if (s === "LEARNING") return "#5b8def";
    return "var(--hq-text-muted)";
  };

  return (
    <HqPanel
      title="Ableton Mastery"
      subtitle="Capability matrix · Mastery Lab · Levels 1–10 (founder only)"
    >
      {gate ? (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            border: "1px solid rgba(61,154,106,0.45)",
            background: "rgba(61,154,106,0.12)",
            color: "var(--hq-text)",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          {gate}
        </div>
      ) : null}

      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <ServiceCard label="AURA Ableton Mastery %" value={`${percent}%`} />
        <ServiceCard label="Mastered" value={String(counts.mastered ?? recentlyMastered.length ?? "—")} />
        <ServiceCard label="Learning" value={String(counts.learning ?? "—")} />
        <ServiceCard
          label="Validation required"
          value={String(counts.validationRequired ?? "—")}
        />
        <ServiceCard label="Failed exercises" value={String(counts.failedExercises ?? "—")} />
      </div>

      <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((lvl) => {
          const L = levels[lvl] || levels[String(lvl)];
          return (
            <div
              key={lvl}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                padding: "0.35rem 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: "0.9rem",
              }}
            >
              <span>
                Level {lvl}
                {L?.name ? ` — ${L.name}` : ""}
              </span>
              <span style={{ color: "var(--hq-text-muted)" }}>
                {L ? `${L.mastered ?? 0}/${L.total ?? "?"} · ${L.percent ?? 0}%` : "—"}
                {L?.complete ? " · COMPLETE" : ""}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <button type="button" className="hq-btn" disabled={!!busy} onClick={() => runValidation()}>
          {busy === "validate" ? "Running…" : "Run Validation"}
        </button>
        <button type="button" className="hq-btn" disabled={!!busy} onClick={() => refreshDashboard()}>
          {busy === "dashboard" ? "Refreshing…" : "Refresh Matrix"}
        </button>
      </div>
      {message ? (
        <p style={{ color: "var(--hq-text-muted)", fontSize: "0.85rem" }}>{message}</p>
      ) : null}

      {demoUrl ? (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ marginBottom: "0.35rem", fontSize: "0.85rem", color: "var(--hq-text-muted)" }}>
            View Demonstration
          </div>
          <audio controls src={demoUrl} style={{ width: "100%", maxWidth: 480 }} />
        </div>
      ) : (
        <p style={{ color: "var(--hq-text-muted)", fontSize: "0.85rem" }}>
          Demonstration audio appears here after Levels 1–3 validation uploads to Mix.
        </p>
      )}

      {recentlyMastered.length > 0 ? (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.85rem", marginBottom: "0.35rem" }}>Recently mastered</div>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--hq-text-muted)", fontSize: "0.85rem" }}>
            {recentlyMastered.slice(0, 8).map((c) => (
              <li key={`${c.level}-${c.name}`}>
                L{c.level} {c.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(inventory.instruments?.length || inventory.packs?.length) ? (
        <div style={{ marginBottom: "1rem", fontSize: "0.85rem", color: "var(--hq-text-muted)" }}>
          Detected instruments: {(inventory.instruments || []).slice(0, 8).join(", ") || "—"}
          {inventory.packs?.length ? ` · Packs: ${inventory.packs.slice(0, 6).join(", ")}` : ""}
        </div>
      ) : null}

      <details>
        <summary style={{ cursor: "pointer", marginBottom: "0.5rem" }}>Capability matrix</summary>
        <div style={{ maxHeight: 320, overflow: "auto", fontSize: "0.8rem" }}>
          {capabilities.length === 0 ? (
            <p style={{ color: "var(--hq-text-muted)" }}>
              Matrix loads after Refresh Matrix or Run Validation on the production node.
            </p>
          ) : (
            capabilities.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.2rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <span>
                  L{c.level} {c.name}
                </span>
                <span style={{ color: statusColor(c.status), whiteSpace: "nowrap" }}>{c.status}</span>
              </div>
            ))
          )}
        </div>
      </details>
    </HqPanel>
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
  const nodeBanner = productionNodeBanner(services?.productionNode);
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
        <StatusBadge label={nodeBanner.label} variant={nodeBanner.variant} pulse={nodeBanner.pulse} />
        {data?.auraMusicReady ? (
          <StatusBadge label="AURA MUSIC OPERATIONAL" variant="success" />
        ) : null}
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
        {PRIMARY_TABS.map(({ id, label, icon: Icon }) => {
          const meta = sectionMeta.get(id);
          const badge = tabBadge(meta);
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
              {badge ? <span className="hq-badge muted" style={{ marginLeft: 4 }}>{badge}</span> : null}
            </button>
          );
        })}
        <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.08)", margin: "0 0.25rem" }} aria-hidden />
        {SECONDARY_TABS.map(({ id, label, icon: Icon }) => (
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
          </button>
        ))}
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

            <HqPanel title="Ableton Bridge — persistence" subtitle="Localhost :4177 · auto-recovery via bridge supervisor">
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {(
                  [
                    ["Bridge Build", data.bridgeBuild || data.summary?.["Bridge Build"] || "UNKNOWN"],
                    ["Expected Build", data.bridgeExpectedBuild || "—"],
                    ["Remote Script", data.remoteScriptStatus || "UNKNOWN"],
                    ["Auto-Recovery", data.autoRecoveryStatus || data.summary?.["Auto-Recovery"] || "UNKNOWN"],
                    ["Restart Count", String(data.bridgeRestartCount ?? 0)],
                    ["Reconnect Attempts", String(data.bridgeReconnectAttempts ?? 0)],
                    ["Last Error", data.bridgeLastError || "none"],
                  ] as const
                ).map(([label, val]) => (
                  <li key={label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                    <span className="hq-kpi-meta">{label}</span>
                    <strong style={{ textAlign: "right", maxWidth: "70%", wordBreak: "break-word" }}>{val}</strong>
                  </li>
                ))}
              </ul>
            </HqPanel>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <HqPanel title="Phase status" subtitle="Roadmap gates — backend-driven">
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

              {data.modules ? <ModuleStatusPanel modules={data.modules} /> : null}

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

        {tab === "library" && <MusicLibraryPanel />}
        {tab === "projects" && (
          <FoundationPlaceholder
            title="Projects"
            note={sectionMeta.get("projects")?.note || "MUSIC-###### project records will surface here from the Secure Music Job Queue."}
          />
        )}
        {tab === "mix" && data && <MixReviewPanel onDone={() => query.refetch()} />}
        {tab === "master" && <MasterReviewPanel onDone={() => query.refetch()} />}
        {tab === "sampling" && <SamplingPanel />}
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
          <>
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
            <div style={{ marginTop: "1.25rem" }}>
              <AbletonMasteryPanel onDone={() => query.refetch()} />
            </div>
          </>
        )}
      </HqQueryBoundary>

      <div style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--hq-text-dim)", fontSize: "0.75rem" }}>
        <Music2 size={14} />
        <span>AURA MUSIC is an IFCDC HQ module — Mixing, Sampling, and Mastering Engine active. Validation masters only until cleared human vocal replaces the placeholder.</span>
        <Radio size={14} style={{ marginLeft: "auto", opacity: 0.5 }} />
      </div>
    </HQLayout>
  );
};

export default AuraMusicCommandCenterPage;
