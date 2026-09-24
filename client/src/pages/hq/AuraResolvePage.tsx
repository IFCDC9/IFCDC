import React, { useEffect, useMemo, useState } from "react";

type Job = {
  id: string;
  command: string;
  status: string;
  createdAt?: string;
  result?: Record<string, unknown> | null;
};

type Preview = {
  id: string;
  name: string;
  project?: string | null;
  duration?: number | null;
  previewUrl: string;
  createdAt?: string;
};

type Board = {
  bridge?: string;
  resolve?: string;
  resolveVersion?: string | null;
  productionMac?: string;
  project?: string | null;
  timeline?: string | null;
  currentJob?: Job | null;
  renderStatus?: string;
  renderPercent?: number | null;
  queue?: Job[];
  assets?: { name: string }[];
  completedRenders?: { name: string; path?: string }[];
  previews?: Preview[];
  creativeMemory?: { id: string; kind: string; createdAt?: string; payload?: Record<string, unknown> }[];
  brandKit?: { assetCount?: number; gaps?: string[] } | null;
  errors?: string[];
  notes?: string[];
  lastHeartbeat?: string | null;
  lastSuccessfulCommand?: { command?: string; at?: string } | Job | null;
  message?: string;
  clonePrep?: Record<string, string>;
  jobs?: Job[];
};

const SAMPLE =
  "Aura, create a short IFCDC Barbers App promotional video using approved assets. Add our branding, music, transitions and a smooth fade-out. Make it vertical for TikTok and show me the draft.";

export default function AuraResolvePage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [instruction, setInstruction] = useState(SAMPLE);
  const [revisionNote, setRevisionNote] = useState("Tighten the ending and keep the gold flash between scenes.");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [selectedAsset, setSelectedAsset] = useState("");
  const [finalApproved, setFinalApproved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/hq/aura/resolve/status", { credentials: "include" });
    if (!response.ok) {
      setBoard({ message: "HQ could not load the Resolve board." });
      return;
    }
    const body = await response.json();
    setBoard(body);
    if (!selectedAsset && body.assets?.[0]?.name) setSelectedAsset(body.assets[0].name);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  const latestPreview = useMemo(() => (board?.previews || [])[0] || null, [board?.previews]);
  const last = board?.lastSuccessfulCommand;
  const lastLabel = last && "command" in last ? last.command : "none";

  async function planInstruction() {
    setBusy(true);
    setNote("Building the creative plan…");
    try {
      const response = await fetch("/api/hq/aura/resolve/plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const body = await response.json();
      setPlan(body.plan || body);
      setNote(body.message || "Plan ready.");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function startProduction() {
    setBusy(true);
    setNote("Starting draft production on the Production Mac…");
    try {
      const response = await fetch("/api/hq/aura/resolve/produce", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, publish: false }),
      });
      const body = await response.json();
      setPlan(body.plan || plan);
      setNote(body.message || (body.ok ? "Production queued." : body.error || "Production refused."));
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function requestRevision() {
    setBusy(true);
    setNote("Queuing revision…");
    try {
      const response = await fetch("/api/hq/aura/resolve/revise", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, revisionNote, publish: false }),
      });
      const body = await response.json();
      setNote(body.message || (body.ok ? "Revision queued." : body.error || "Revision refused."));
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await fetch(`/api/hq/aura/resolve/jobs/${id}/cancel`, { method: "POST", credentials: "include" });
    void load();
  }

  async function queueFinalRender() {
    if (!finalApproved) {
      setNote("Founder approval is required before a final render.");
      return;
    }
    setNote("Final render stays gated. Publishing is disabled. Draft renders use Start production.");
  }

  return (
    <section className="aura-resolve-page">
      <style>{`
        .aura-resolve-page { display:grid; gap:1rem; max-width:1100px; }
        .aura-resolve-page h1 { margin:0; font-size:clamp(1.35rem, 4vw, 1.85rem); }
        .aura-status-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0.6rem; }
        @media (min-width:720px) { .aura-status-grid { grid-template-columns:repeat(4,minmax(0,1fr)); } }
        .aura-card { border:1px solid rgba(201,162,39,0.35); border-radius:12px; padding:0.8rem; background:rgba(0,0,0,0.18); }
        .aura-actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
        .aura-actions .hq-btn { flex:1 1 140px; min-height:44px; }
        .aura-resolve-page textarea, .aura-resolve-page select, .aura-resolve-page input {
          width:100%; margin-top:8px; min-height:44px; border-radius:10px; border:1px solid rgba(201,162,39,0.35);
          background:rgba(0,0,0,0.25); color:inherit; padding:0.7rem; box-sizing:border-box;
        }
        .aura-resolve-page textarea { min-height:110px; resize:vertical; }
        .aura-preview video { width:100%; max-height:70vh; border-radius:12px; background:#000; }
        .aura-two { display:grid; gap:0.75rem; }
        @media (min-width:900px) { .aura-two { grid-template-columns:1.2fr 0.8fr; } }
        .aura-muted { opacity:0.8; font-size:0.9rem; }
        .aura-pill { display:inline-block; padding:0.15rem 0.55rem; border-radius:999px; border:1px solid rgba(201,162,39,0.45); font-size:0.75rem; }
      `}</style>

      <header>
        <h1>AURA Video Production</h1>
        <p className="hq-kpi-meta" style={{ margin: "0.25rem 0 0" }}>
          DaVinci Resolve · Founder phone control. Draft only. Publish stays off.
        </p>
      </header>

      <div className="aura-status-grid">
        {[
          ["Bridge", board?.bridge],
          ["Resolve", board?.resolve],
          ["Production Mac", board?.productionMac],
          ["Project", board?.project || "none"],
          ["Timeline", board?.timeline || "none"],
          ["Render", board?.renderStatus || "idle"],
          ["Progress", board?.renderPercent == null ? "—" : `${board.renderPercent}%`],
          ["Version", board?.resolveVersion || "—"],
        ].map(([label, value]) => (
          <div key={label} className="aura-card">
            <div className="hq-kpi-meta">{label}</div>
            <div style={{ fontWeight: 700, marginTop: 4, wordBreak: "break-word" }}>{value || "OFFLINE"}</div>
          </div>
        ))}
      </div>

      <p style={{ margin: 0 }}>{note || board?.message}</p>

      <div className="aura-two">
        <div className="aura-card">
          <div className="hq-kpi-meta">Instruction</div>
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={5} />
          <div className="hq-kpi-meta" style={{ marginTop: 12 }}>Asset focus</div>
          <select value={selectedAsset} onChange={(event) => setSelectedAsset(event.target.value)}>
            <option value="">Approved media on Production Mac</option>
            {(board?.assets || []).map((asset) => (
              <option key={asset.name} value={asset.name}>{asset.name}</option>
            ))}
          </select>
          <div className="aura-actions" style={{ marginTop: 12 }}>
            <button type="button" className="hq-btn" disabled={busy} onClick={() => void planInstruction()}>Plan</button>
            <button type="button" className="hq-btn hq-btn-primary" disabled={busy} onClick={() => void startProduction()}>
              Start production
            </button>
          </div>
          <div className="hq-kpi-meta" style={{ marginTop: 12 }}>Revision request</div>
          <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} rows={3} />
          <div className="aura-actions" style={{ marginTop: 8 }}>
            <button type="button" className="hq-btn" disabled={busy} onClick={() => void requestRevision()}>
              Request revision
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="aura-muted">
              <input type="checkbox" checked={finalApproved} onChange={(event) => setFinalApproved(event.target.checked)} />{" "}
              Founder approval for final render (publish still blocked)
            </label>
            <div className="aura-actions" style={{ marginTop: 8 }}>
              <button type="button" className="hq-btn" disabled={!finalApproved || busy} onClick={() => void queueFinalRender()}>
                Final render (gated)
              </button>
            </div>
          </div>
        </div>

        <div className="aura-card">
          <div className="hq-kpi-meta">Draft preview</div>
          {latestPreview ? (
            <div className="aura-preview" style={{ marginTop: 8 }}>
              <video key={latestPreview.id} controls playsInline src={latestPreview.previewUrl} />
              <div className="aura-muted" style={{ marginTop: 8 }}>
                {latestPreview.name}
                {latestPreview.duration != null ? ` · ${Number(latestPreview.duration).toFixed(1)}s` : ""}
                {latestPreview.project ? ` · ${latestPreview.project}` : ""}
              </div>
              <span className="aura-pill">publish:false</span>
            </div>
          ) : (
            <p className="aura-muted">No HQ draft yet. Start production to return a vertical preview.</p>
          )}
          <div className="hq-kpi-meta" style={{ marginTop: 12 }}>Job status</div>
          <p style={{ margin: "6px 0 0" }}>
            {board?.currentJob ? `${board.currentJob.command} · ${board.currentJob.status}` : "none"}
          </p>
          <div className="hq-kpi-meta" style={{ marginTop: 12 }}>Queue</div>
          {(board?.queue || []).length ? (
            (board?.queue || []).map((job) => (
              <div key={job.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
                <span>{job.command} · {job.status}</span>
                {job.status === "queued" ? (
                  <button type="button" className="hq-btn" onClick={() => void cancel(job.id)}>Cancel</button>
                ) : null}
              </div>
            ))
          ) : (
            <p className="aura-muted">none</p>
          )}
        </div>
      </div>

      {plan ? (
        <div className="aura-card">
          <div className="hq-kpi-meta">Creative plan</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {[
              ["PURPOSE", plan.PURPOSE],
              ["AUDIENCE", plan.AUDIENCE],
              ["DURATION", plan.DURATION],
              ["FORMAT", plan.FORMAT],
              ["PROJECT", plan.project],
              ["BRANDING", plan.BRANDING],
              ["MUSIC", plan.MUSIC],
              ["TRANSITIONS", plan.TRANSITIONS],
              ["ENDING", plan.ENDING],
              ["RENDER", plan.RENDER_FORMAT],
            ].map(([label, value]) => (
              <div key={String(label)}><strong>{label}:</strong> {String(value || "—")}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="aura-status-grid">
        <List title="Brand kit" lines={[
          board?.brandKit?.assetCount != null ? `${board.brandKit.assetCount} staged assets` : "pending Mac sync",
          ...((board?.brandKit?.gaps || []).slice(0, 3)),
        ]} />
        <List title="Completed renders (Mac)" lines={(board?.completedRenders || []).map((file) => file.name)} />
        <List title="HQ preview history" lines={(board?.previews || []).map((item) => `${item.name}${item.duration != null ? ` (${Number(item.duration).toFixed(1)}s)` : ""}`)} />
        <List title="Creative memory" lines={(board?.creativeMemory || []).map((item) => `${item.kind} · ${item.createdAt || ""}`)} />
        <List title="Media / assets" lines={(board?.assets || []).map((asset) => asset.name)} />
        <List title="Errors" lines={board?.errors || []} />
        <List title="Notes" lines={board?.notes || []} />
        <List title="Clone prep (placeholders)" lines={Object.entries(board?.clonePrep || {}).map(([key, value]) => `${key}: ${value}`)} />
        <List title="Last heartbeat" lines={[board?.lastHeartbeat || "none"]} />
        <List title="Last successful command" lines={[String(lastLabel || "none")]} />
      </div>
    </section>
  );
}

function List({ title, lines }: { title: string; lines: string[] }) {
  const shown = lines.length ? lines : ["none"];
  return (
    <div className="aura-card">
      <div className="hq-kpi-meta">{title}</div>
      {shown.map((line) => (
        <div key={line} style={{ marginTop: 6, wordBreak: "break-word" }}>{line}</div>
      ))}
    </div>
  );
}
