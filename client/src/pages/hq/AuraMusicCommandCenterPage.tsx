/**
 * AURA MUSIC Command Center — IFCDC HQ module.
 * Phase 3 controlled mixing intelligence enabled (engineering racks, Mix V1).
 * AURA DJ — Serato is a primary tab inside this command center (not a separate AURA system).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
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

/** Primary row — AURA DJ must stay visible without horizontal scroll hunting */
const PRIMARY_TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "library", label: "Library", icon: Library },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "mix", label: "Mix", icon: SlidersHorizontal },
  { id: "sampling", label: "Sampling", icon: AudioWaveform },
  { id: "master", label: "Master", icon: Disc3 },
  { id: "serato", label: "AURA DJ — Serato", icon: Radio },
] as const;

const SECONDARY_TABS = [
  { id: "jobs", label: "Jobs", icon: ListTodo },
  { id: "ableton", label: "Ableton", icon: Cable },
] as const;

const TABS = [...PRIMARY_TABS, ...SECONDARY_TABS] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return Boolean(value && TABS.some((t) => t.id === value));
}

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
  const continuing =
    mastery.fullAbletonCapabilityMasteryPercent ?? mastery.overallPercent;
  const core = mastery.coreProductionReadiness || "PRODUCTION_READY";
  return (
    <HqPanel title="AURA module state" subtitle="Core readiness vs continuing Ableton capability">
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
        <div className="hq-kpi-meta">Core Production Readiness</div>
        <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--hq-success, #3d9a6a)" }}>{core}</div>
        <div className="hq-kpi-meta" style={{ marginTop: "0.75rem" }}>
          Full Ableton Capability Mastery (continuing)
        </div>
        <div style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--hq-gold)" }}>
          {continuing != null ? `${continuing}%` : "—"}
        </div>
        <div className="hq-kpi-meta" style={{ marginTop: "0.35rem" }}>
          Not the same as Core Ready · Advances via real projects · Lab matrix{" "}
          {mastery.labMatrixPercent != null ? `${mastery.labMatrixPercent}%` : "—"} · Domains MASTERED{" "}
          {mastery.fullMasteryDomainsMastered != null
            ? `${mastery.fullMasteryDomainsMastered}/${mastery.fullMasteryDomainsTotal ?? "?"}`
            : "—"}
        </div>
        <div className="hq-kpi-meta" style={{ marginTop: "0.35rem" }}>
          Level 7 {mastery.level7Complete ? "complete" : "in progress"} · Level 9 {mastery.level9Complete ? "complete" : "pending"}
        </div>
      </div>
    </HqPanel>
  );
}

function SeratoDjPanel({ modules }: { modules?: AuraMusicCommandCenter["modules"] }) {
  const seratoQuery = useQuery({
    queryKey: ["hq-aura-music-serato"],
    queryFn: () => hqApi.auraMusicSerato(),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  const decksQuery = useQuery({
    queryKey: ["hq-aura-music-serato-decks"],
    queryFn: () => hqApi.auraMusicSeratoDecks(),
    refetchInterval: 3_000,
    staleTime: 1_000,
    retry: 0,
  });
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [selectedTrackPath, setSelectedTrackPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [launchMsg, setLaunchMsg] = useState("");
  const [cmdLog, setCmdLog] = useState<string>("");

  const tracksQuery = useQuery({
    queryKey: ["hq-aura-music-serato-tracks", selectedCrateId],
    queryFn: () => hqApi.auraMusicSeratoCrateTracks(String(selectedCrateId)),
    enabled: Boolean(selectedCrateId),
    staleTime: 10_000,
  });

  const dash = seratoQuery.data;
  const live = dash?.live || {};
  const domains = (dash?.domains || modules?.auraDjSerato?.domains || {}) as Record<string, string>;
  const crates = dash?.crates || [];
  const bridge = (dash?.bridge || {}) as Record<string, any>;
  const visibility = (dash?.visibility || {}) as Record<string, string>;
  const progress = dash?.progress || null;
  const currentBlocker = dash?.currentBlocker || null;
  const coreFoundation = (dash?.coreFoundation || null) as {
    title?: string;
    status?: string;
    display?: string;
    softwareFirst?: boolean;
    controllerRequired?: boolean;
  } | null;
  const certification = (dash?.certification || null) as Record<string, any> | null;
  const operatingModel = (dash?.operatingModel || null) as Record<string, any> | null;
  const intelligence = (dash?.intelligence || null) as Record<string, any> | null;
  const memory = (dash?.memory || null) as Record<string, any> | null;

  const rows: Array<[string, string]> = [
    ["Serato DJ Pro", domains.seratoDjPro || live.seratoDjProRunning || "NOT_BUILT"],
    ["Library", domains.library || live.seratoLibraryAccess || "NOT_BUILT"],
    ["Founder Mac node", visibility.founderMacSeratoNode || domains.localNode || "ONLINE"],
    ["AURA–Serato Bridge", visibility.bridge || domains.auraSeratoBridge || live.bridgeConnected || "NOT_BUILT"],
    ["Read-only Deck State", domains.readOnlyDeckState || "NOT_BUILT"],
    ["Control", domains.control || domains.controlBridge || "NOT_BUILT"],
    ["Transport", domains.transport || progress?.lessons?.find((l: any) => l.id === "transport")?.status || "TESTING"],
    ["BPM / Key", domains.bpmKey || "NOT_BUILT"],
    ["Cue / Grid", domains.cueGridIntelligence || domains.cueGrid || "NOT_BUILT"],
    ["Two-deck", domains.twoDeckState || "NOT_BUILT"],
    ["Crossfader", progress?.lessons?.find((l: any) => l.id === "crossfader")?.status || "TESTING"],
    ["Channel Faders", progress?.lessons?.find((l: any) => l.id === "channel-faders")?.status || "TESTING"],
    ["Transition Intelligence", domains.transitionPlanning || domains.transitionIntelligence || "NOT_BUILT"],
    ["Safe Transition", progress?.lessons?.find((l: any) => l.id === "safe-transition")?.status || "TESTING"],
    ["Live Mixing", domains.liveMixing || progress?.lessons?.find((l: any) => l.id === "live-mixing")?.status || "NOT_BUILT"],
    ["Stems", domains.stems || "NOT_BUILT"],
    ["Set Memory", domains.setMemory || "NOT_BUILT"],
  ];

  async function launchSerato() {
    setBusy("launch");
    setLaunchMsg("");
    try {
      const res = await hqApi.auraMusicSeratoLaunch();
      setLaunchMsg(res.ok ? (res.running ? "Serato DJ Pro is running." : "Launch requested — check Dock.") : res.error || "Launch failed");
      await seratoQuery.refetch();
    } catch (e) {
      setLaunchMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runControl(command: string) {
    if (!selectedTrackPath && command.startsWith("load_track")) {
      setCmdLog("Select a track first.");
      return;
    }
    setBusy(command);
    setCmdLog("");
    try {
      const res = await hqApi.auraMusicSeratoCommand(command, {
        trackPath: selectedTrackPath,
        deck: command.includes("deck_b") ? "B" : "A",
      });
      const result = res.result || res;
      setCmdLog(
        JSON.stringify(
          {
            ok: res.ok,
            command,
            success: (result as any)?.success,
            error: (result as any)?.error || res.error,
            visibleStateAfter: (result as any)?.visibleStateAfter?.decks?.A?.track || null,
          },
          null,
          2
        )
      );
      await Promise.all([seratoQuery.refetch(), decksQuery.refetch()]);
    } catch (e) {
      setCmdLog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function fmtDur(sec: number | null | undefined) {
    if (sec == null || !Number.isFinite(sec)) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function statusVariant(status: string) {
    const s = String(status).toUpperCase();
    if (s === "PASSED" || s === "CONNECTED" || s === "RUNNING" || s === "ONLINE") return "success" as const;
    if (s.includes("OFFLINE") || s.includes("DISCONNECTED") || s === "BLOCKED" || s === "NOT_BUILT") return "muted" as const;
    if (s === "TESTING" || s === "BUILT") return "gold" as const;
    return "muted" as const;
  }

  const hqDeckA = dash?.decks?.A;
  const hqDeckB = dash?.decks?.B;
  const liveDeckA = (decksQuery.data?.hqDecks as any)?.A || (decksQuery.data?.decks as any)?.A;
  const liveDeckB = (decksQuery.data?.hqDecks as any)?.B || (decksQuery.data?.decks as any)?.B;

  function deckCard(label: string, hq: typeof hqDeckA, live: any) {
    const title = hq?.title || live?.track?.title || live?.title || "EMPTY";
    const artist = hq?.artist || live?.track?.artist || live?.artist || null;
    const bpm = hq?.bpm ?? live?.bpm ?? live?.track?.bpm ?? "UNKNOWN";
    const key = hq?.key ?? live?.track?.key ?? live?.key ?? "UNKNOWN";
    const play = hq?.play || live?.play || "UNKNOWN";
    const pos = hq?.positionSeconds ?? live?.positionSeconds;
    const cue = hq?.cue ?? live?.cue;
    const grid = hq?.gridTrust ?? live?.gridTrust;
    const phrase = (hq?.phrase as any)?.status || (live?.phrase as any)?.status || null;
    return (
      <div
        style={{
          padding: "0.85rem 1rem",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(0,0,0,0.28)",
          minWidth: 0,
        }}
      >
        <div style={{ fontWeight: 750, marginBottom: "0.35rem" }}>{label}</div>
        <div style={{ fontSize: "1.05rem", fontWeight: 650, wordBreak: "break-word" }}>{title}</div>
        <div className="hq-kpi-meta" style={{ marginTop: "0.25rem" }}>
          {artist || "—"} · {play} · BPM {String(bpm)} · Key {String(key)}
        </div>
        <div className="hq-kpi-meta" style={{ marginTop: "0.35rem" }}>
          Pos {pos != null && Number.isFinite(Number(pos)) ? `${Number(pos).toFixed(1)}s` : "—"} · Cue{" "}
          {cue == null ? "—" : String(typeof cue === "object" ? "set" : cue)} · Grid {grid == null ? "—" : String(grid)}
          {phrase ? ` · Phrase ${phrase}` : ""}
        </div>
      </div>
    );
  }

  const offlineBanner =
    visibility.founderMacSeratoNode === "SERATO NODE OFFLINE"
      ? "SERATO NODE OFFLINE"
      : visibility.bridge === "BRIDGE DISCONNECTED" || String(bridge?.status || "").includes("DISCONNECTED")
        ? "BRIDGE DISCONNECTED"
        : visibility.seratoDjPro === "SERATO OFFLINE" || live.seratoDjProRunning === "NO"
          ? "SERATO OFFLINE"
          : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <HqPanel
        title="AURA DJ — Serato"
        subtitle="Founder → IFCDC HQ → AURA DJ → Bridge → Serato DJ Pro software · controllers optional · live data only"
      >
        {offlineBanner ? (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.75rem 1rem",
              border: "1px solid rgba(245,158,11,0.45)",
              color: "var(--hq-warning)",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            {offlineBanner}
          </div>
        ) : null}

        <div
          style={{
            marginBottom: "1rem",
            padding: "0.9rem 1.1rem",
            border: "1px solid rgba(34,197,94,0.45)",
            background: "rgba(34,197,94,0.1)",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div className="hq-kpi-meta">AURA DJ CORE FOUNDATION</div>
            <div style={{ fontWeight: 800, fontSize: "1.15rem", marginTop: "0.2rem" }}>
              {coreFoundation?.display ||
                (progress?.passedCount != null
                  ? `${progress.passedCount} / ${progress.totalCount} PASSED`
                  : "11 / 11 PASSED")}
            </div>
            <div className="hq-kpi-meta" style={{ marginTop: "0.35rem" }}>
              Software-first Serato control · Controllers = optional accessory only
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            <StatusBadge
              label={coreFoundation?.status || progress?.overallStatus || "PASSED"}
              variant={statusVariant(String(coreFoundation?.status || progress?.overallStatus || "PASSED"))}
            />
            <StatusBadge label="SOFTWARE-FIRST" variant="success" />
            <StatusBadge label="NO CONTROLLER REQUIRED" variant="muted" />
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
          <button type="button" className="hq-btn" disabled={!!busy} onClick={() => void launchSerato()}>
            {busy === "launch" ? "Launching…" : "Open Serato DJ Pro"}
          </button>
          <button
            type="button"
            className="hq-btn hq-btn-secondary"
            disabled={seratoQuery.isFetching}
            onClick={() => void Promise.all([seratoQuery.refetch(), decksQuery.refetch()])}
          >
            Refresh live status
          </button>
          {launchMsg ? <span className="hq-kpi-meta">{launchMsg}</span> : null}
          {dash?.source ? <span className="hq-kpi-meta">source: {dash.source}</span> : null}
        </div>

        <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
          <ServiceCard label="AURA DJ" value={String(visibility.auraDj || "—")} />
          <ServiceCard
            label="Serato DJ Pro"
            value={String(
              visibility.seratoDjPro ||
                (live as any).seratoDjProStatus ||
                (live.seratoDjProRunning === "YES" ? "RUNNING" : "SERATO OFFLINE")
            )}
          />
          <ServiceCard
            label="AURA–Serato bridge"
            value={String(visibility.bridge || domains.auraSeratoBridge || "BRIDGE DISCONNECTED")}
            meta={bridge?.bind ? String(bridge.bind) : "127.0.0.1:4179"}
          />
          <ServiceCard
            label="Founder Mac Serato node"
            value={String(visibility.founderMacSeratoNode || live.localNode || "—")}
          />
          <ServiceCard label="Remote observer" value={String((live as any).remoteObserver || domains.remoteObserver || "DISCONNECTED")} />
          <ServiceCard
            label="Control"
            value={String((live as any).controlChannel || domains.control || "BLOCKED")}
            meta={(live as any).controlBlockedReason ? String((live as any).controlBlockedReason) : undefined}
          />
          <ServiceCard
            label="Transition intelligence"
            value={String(domains.transitionIntelligence || domains.transitionPlanning || "NOT_BUILT")}
          />
          <ServiceCard
            label="Last heartbeat"
            value={live.lastHeartbeat ? "LIVE" : "—"}
            meta={live.lastHeartbeat ? new Date(String(live.lastHeartbeat)).toLocaleString() : undefined}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(201,162,39,0.35)", background: "rgba(201,162,39,0.08)" }}>
            <div className="hq-kpi-meta">Current lesson</div>
            <div style={{ fontWeight: 750, marginTop: "0.25rem" }}>
              {progress?.currentLesson?.label || "—"}
            </div>
            {progress?.currentLesson?.status ? (
              <div style={{ marginTop: "0.4rem" }}>
                <StatusBadge label={progress.currentLesson.status} variant={statusVariant(progress.currentLesson.status)} />
              </div>
            ) : null}
          </div>
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.22)" }}>
            <div className="hq-kpi-meta">Competency</div>
            <div style={{ fontWeight: 700, marginTop: "0.25rem" }}>{progress?.currentCompetency || "—"}</div>
          </div>
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.22)" }}>
            <div className="hq-kpi-meta">Progress</div>
            <div style={{ fontWeight: 750, marginTop: "0.25rem" }}>
              {progress?.passedCount != null ? `${progress.passedCount} / ${progress.totalCount}` : "—"}
              {progress?.progressPercent != null ? ` · ${progress.progressPercent}%` : ""}
            </div>
            {progress?.overallStatus ? (
              <div style={{ marginTop: "0.4rem" }}>
                <StatusBadge label={progress.overallStatus} variant={statusVariant(progress.overallStatus)} />
              </div>
            ) : null}
          </div>
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.22)" }}>
            <div className="hq-kpi-meta">Last completed</div>
            <div style={{ fontWeight: 650, marginTop: "0.25rem" }}>{progress?.lastCompletedLesson?.label || "—"}</div>
          </div>
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.22)" }}>
            <div className="hq-kpi-meta">Next objective</div>
            <div style={{ fontWeight: 650, marginTop: "0.25rem" }}>
              {progress?.nextLesson?.label || certification?.currentObjective?.label || "—"}
            </div>
          </div>
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.08)" }}>
            <div className="hq-kpi-meta">Current blocker</div>
            <div style={{ fontWeight: 650, marginTop: "0.25rem", wordBreak: "break-word", fontSize: "0.9rem" }}>
              {currentBlocker || "None — core foundation clear"}
            </div>
          </div>
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.22)" }}>
            <div className="hq-kpi-meta">DJ intelligence</div>
            <div style={{ fontWeight: 650, marginTop: "0.25rem", fontSize: "0.9rem" }}>
              {intelligence?.cycle?.ticks != null
                ? `${intelligence.cycle.ticks} ticks · next ${intelligence?.cycle?.activeKnowledge?.nextObjective?.label || "—"}`
                : operatingModel?.loop
                  ? "Loop armed"
                  : "—"}
            </div>
          </div>
          <div style={{ padding: "0.85rem 1rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.22)" }}>
            <div className="hq-kpi-meta">Memory status</div>
            <div style={{ fontWeight: 650, marginTop: "0.25rem", fontSize: "0.9rem" }}>
              {memory?.verifiedControls
                ? `${memory.verifiedControls.length} verified controls · ${memory?.mixLessons?.count ?? 0} mix lessons`
                : certification?.coreMatrix?.status === "PASSED"
                  ? "Core 11/11 locked · permanent"
                  : "—"}
            </div>
          </div>
        </div>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {rows.map(([label, status]) => (
            <li
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.75rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span>{label}</span>
              <StatusBadge label={String(status)} variant={statusVariant(String(status))} />
            </li>
          ))}
        </ul>
        {live.lastError ? (
          <p className="hq-kpi-meta" style={{ marginTop: "0.75rem", color: "var(--hq-warning)" }}>
            Last error: {String(live.lastError)}
          </p>
        ) : null}
        {dash?.message ? (
          <p className="hq-kpi-meta" style={{ marginTop: "0.5rem" }}>
            {dash.message}
          </p>
        ) : null}
      </HqPanel>

      <HqPanel title="Live decks" subtitle="Deck A / Deck B — title, artist, BPM, key, play/pause, cue/grid">
        {decksQuery.isError && !dash?.decks ? (
          <p style={{ color: "var(--hq-warning)", margin: 0 }}>
            {offlineBanner || "BRIDGE DISCONNECTED — start aura-serato-bridge on Founder Mac"}
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {deckCard("Deck A", hqDeckA, liveDeckA)}
            {deckCard("Deck B", hqDeckB, liveDeckB)}
          </div>
        )}
      </HqPanel>

      <HqPanel title="Serato crates (real)" subtitle="Click a crate → select a track → gated control test (Founder Mac)">
        {seratoQuery.isLoading ? (
          <p className="hq-kpi-meta">Loading Serato library…</p>
        ) : crates.length === 0 ? (
          <p style={{ color: "var(--hq-text-muted)", margin: 0 }}>
            No crates readable on this HQ host. Live status still updates from the Founder Mac node when online.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {crates.map((c) => (
              <li key={c.id} style={{ padding: "0.55rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <button
                  type="button"
                  className="hq-btn hq-btn-secondary"
                  style={{ width: "100%", justifyContent: "space-between", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}
                  onClick={() => {
                    setSelectedCrateId(c.id);
                    setSelectedTrackPath(null);
                  }}
                >
                  <span style={{ fontWeight: 650 }}>{c.name}</span>
                  <span className="hq-kpi-meta">
                    {c.trackCount} tracks · {c.kind || "crate"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </HqPanel>

      {selectedCrateId ? (
        <HqPanel
          title={tracksQuery.data?.crate?.name ? `Crate: ${tracksQuery.data.crate.name}` : "Crate tracks"}
          subtitle="BPM/key from real ID3/Serato tags only — UNKNOWN if missing"
        >
          {tracksQuery.isLoading ? (
            <p className="hq-kpi-meta">Reading crate tracks…</p>
          ) : tracksQuery.data?.ok === false ? (
            <p style={{ color: "var(--hq-warning)" }}>{tracksQuery.data.error || "Failed to load tracks"}</p>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <button
                  type="button"
                  className="hq-btn"
                  disabled={!!busy || !selectedTrackPath}
                  onClick={() => void runControl("load_track_deck_a")}
                >
                  Load → Deck A
                </button>
                <button type="button" className="hq-btn" disabled={!!busy || !selectedTrackPath} onClick={() => void runControl("play")}>
                  Play
                </button>
                <button type="button" className="hq-btn" disabled={!!busy || !selectedTrackPath} onClick={() => void runControl("pause")}>
                  Pause
                </button>
              </div>
              {selectedTrackPath ? (
                <p className="hq-kpi-meta" style={{ marginBottom: "0.75rem", wordBreak: "break-all" }}>
                  Selected: {selectedTrackPath}
                </p>
              ) : (
                <p className="hq-kpi-meta" style={{ marginBottom: "0.75rem" }}>
                  Select a track row, then Load → Deck A. PASS only if Serato deck state confirms.
                </p>
              )}
              {cmdLog ? (
                <pre
                  style={{
                    marginBottom: "0.75rem",
                    padding: "0.75rem",
                    background: "rgba(0,0,0,0.35)",
                    fontSize: "0.75rem",
                    overflow: "auto",
                    maxHeight: 180,
                  }}
                >
                  {cmdLog}
                </pre>
              ) : null}
              <div className="hq-table-scroll">
                <table className="hq-table hq-table-compact">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Title</th>
                      <th>Artist</th>
                      <th>BPM</th>
                      <th>Key</th>
                      <th>Duration</th>
                      <th>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tracksQuery.data?.tracks || []).map((t) => (
                      <tr
                        key={t.path}
                        style={{
                          background: selectedTrackPath === t.path ? "rgba(201,162,39,0.12)" : undefined,
                          cursor: "pointer",
                        }}
                        onClick={() => setSelectedTrackPath(t.path)}
                      >
                        <td>
                          <input
                            type="radio"
                            checked={selectedTrackPath === t.path}
                            onChange={() => setSelectedTrackPath(t.path)}
                          />
                        </td>
                        <td>{t.title}</td>
                        <td>{t.artist || "UNKNOWN"}</td>
                        <td>{t.bpm ?? "UNKNOWN"}</td>
                        <td>{t.key ?? "UNKNOWN"}</td>
                        <td>{fmtDur(t.durationSeconds)}</td>
                        <td style={{ maxWidth: 280, wordBreak: "break-all", fontSize: "0.75rem" }}>
                          {t.exists ? "on disk" : "missing"} · {t.path}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </HqPanel>
      ) : null}
    </div>
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
  const foundation = dash.foundationReadiness || {};
  const percent =
    typeof dash.fullAbletonCapabilityMasteryPercent === "number"
      ? dash.fullAbletonCapabilityMasteryPercent
      : typeof foundation.fullAbletonCapabilityMasteryPercent === "number"
        ? foundation.fullAbletonCapabilityMasteryPercent
        : typeof dash.overallMasteryPercent === "number"
          ? dash.overallMasteryPercent
          : masteryQuery.data?.overallMasteryPercent ?? 49.6;
  const coreReady =
    dash.coreProductionReadiness || foundation.coreProductionReadiness || "PRODUCTION_READY";
  const levels = (dash.levels || dash.dashboard?.levels || {}) as Record<
    string,
    { name?: string; mastered?: number; total?: number; percent?: number; complete?: boolean }
  >;
  const counts = (dash.counts || dash.dashboard?.counts || {}) as Record<string, number>;
  const fullMasteryDomains = dash.fullMasteryDomains || foundation.fullMasteryDomains || {};
  const masteredDomains =
    typeof fullMasteryDomains.mastered === "number"
      ? fullMasteryDomains.mastered
      : typeof counts.mastered === "number"
        ? counts.mastered
        : Object.values(levels).reduce((n, L) => n + (Number(L?.mastered) || 0), 0);
  const totalDomains =
    typeof fullMasteryDomains.total === "number"
      ? fullMasteryDomains.total
      : typeof counts.total === "number"
        ? counts.total
        : Object.values(levels).reduce((n, L) => n + (Number(L?.total) || 0), 0);
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
      subtitle="Core Production Readiness ≠ Full Ableton Capability Mastery · Levels 1–10 continuing"
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
        <ServiceCard label="Core Production Readiness" value={String(coreReady)} meta="Cleared for normal production use" />
        <ServiceCard
          label="Full Ableton Capability Mastery"
          value={`${percent}%`}
          meta="Continuing — real projects advance this · not auto-set to 100%"
        />
        <ServiceCard
          label="Full-mastery domains (MASTERED)"
          value={totalDomains ? `${masteredDomains}/${totalDomains}` : String(masteredDomains ?? "—")}
          meta="Capability matrix domains with MASTERED status — not Core Ready"
        />
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const [tab, setTab] = useState<TabId>(() => (isTabId(tabFromUrl) ? tabFromUrl : "dashboard"));

  useEffect(() => {
    if (isTabId(tabFromUrl) && tabFromUrl !== tab) {
      setTab(tabFromUrl);
    }
  }, [tabFromUrl, tab]);

  function selectTab(id: TabId) {
    setTab(id);
    const next = new URLSearchParams(searchParams);
    if (id === "dashboard") next.delete("tab");
    else next.set("tab", id);
    setSearchParams(next, { replace: true });
  }

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
  const djPreview = data?.modules?.auraDjSerato;

  return (
    <HQLayout
      title="AURA MUSIC"
      subtitle="HQ music production command center — Ableton production + AURA DJ (Serato) Core Foundation 11/11"
      auraModule="aura"
      auraActions={["ask", "summarize"]}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <StatusBadge label={nodeBanner.label} variant={nodeBanner.variant} pulse={nodeBanner.pulse} />
        {data?.auraMusicReady ? (
          <StatusBadge label="AURA MUSIC OPERATIONAL" variant="success" />
        ) : null}
        <StatusBadge
          label={
            djPreview?.coreFoundation?.display
              ? `AURA DJ CORE ${djPreview.coreFoundation.display}`
              : djPreview?.progress?.overallStatus === "PASSED"
                ? "AURA DJ CORE FOUNDATION 11 / 11 PASSED"
                : "AURA DJ — SERATO"
          }
          variant={djPreview?.progress?.overallStatus === "PASSED" || djPreview?.coreFoundation?.status === "PASSED" ? "success" : "gold"}
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

      {/* Always-visible entry — do not bury AURA DJ behind secondary tabs */}
      <div
        style={{
          marginBottom: "1rem",
          padding: "1rem 1.15rem",
          border: "2px solid var(--hq-gold)",
          background: "linear-gradient(135deg, rgba(201,162,39,0.18), rgba(0,0,0,0.25))",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.85rem",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: "1.15rem", letterSpacing: "0.02em" }}>AURA DJ — SERATO</div>
          <div className="hq-kpi-meta">Live Serato status · lessons · decks · progress — same HQ as Ableton</div>
        </div>
        <button
          type="button"
          className="hq-btn"
          style={{ minHeight: 48, padding: "0.75rem 1.25rem", fontWeight: 700 }}
          onClick={() => selectTab("serato")}
        >
          <Radio size={16} /> Open AURA DJ — Serato
        </button>
      </div>

      <div className="hq-tabs" role="tablist" aria-label="AURA MUSIC sections" style={{ flexWrap: "wrap" }}>
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
              onClick={() => selectTab(id)}
              style={id === "serato" ? { borderColor: "rgba(201,162,39,0.55)" } : undefined}
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
            onClick={() => selectTab(id)}
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
            <div
              className="hq-panel"
              style={{ marginBottom: "1rem", borderColor: "rgba(201,162,39,0.4)", cursor: "pointer" }}
              onClick={() => selectTab("serato")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectTab("serato");
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="hq-panel-body" style={{ padding: "0.9rem 1.1rem", display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Open AURA DJ — Serato</div>
                  <div className="hq-kpi-meta">
                    Phase 1 open · Connection {String((djPreview?.domains as Record<string, string> | undefined)?.seratoConnection || "…")}
                    {" · "}
                    {(djPreview?.crates || []).length} crates · route /hq/aura-music?tab=serato
                  </div>
                </div>
                <button type="button" className="hq-btn" onClick={(e) => { e.stopPropagation(); selectTab("serato"); }}>
                  <Radio size={14} /> Open AURA DJ
                </button>
              </div>
            </div>

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
        {tab === "serato" && <SeratoDjPanel modules={data?.modules} />}
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
