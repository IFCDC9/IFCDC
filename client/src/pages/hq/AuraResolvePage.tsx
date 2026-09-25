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

type KitSlot = {
  id: string;
  label: string;
  status: string;
  pathHint?: string | null;
  note?: string | null;
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
  brandKit?: { assetCount?: number; gaps?: string[]; productionKitItems?: number; company?: string; productionKitSlots?: { slots?: KitSlot[] } } | null;
  gate?: string;
  gateStates?: string[];
  publish?: boolean;
  distributionBlocked?: boolean;
  company?: string;
  productionCompany?: string;
  productionIdentity?: string;
  brandPromoted?: string | null;
  errors?: string[];
  notes?: string[];
  lastHeartbeat?: string | null;
  lastSuccessfulCommand?: { command?: string; at?: string } | Job | null;
  message?: string;
  clonePrep?: Record<string, unknown>;
  generation?: { capabilities?: Record<string, { status?: string; provider?: string; blocker?: string }> } | null;
  pipeline?: { stages?: string[]; currentStage?: string } | null;
  continuity?: Record<string, unknown> | null;
  assetLibrary?: { count?: number; categories?: string[] } | null;
  productionKitSlots?: { slots?: KitSlot[]; presentCount?: number; missingCount?: number } | null;
  founderIdentity?: {
    FOUNDATION_MEDIA_MISSING?: boolean;
    designations?: {
      slots?: { id: string; label: string; status: string; fileName?: string | null }[];
      missingDesignations?: string[];
    };
  } | null;
  phase?: number;
  jobs?: Job[];
};

const SAMPLE =
  "Aura, make a 15-second IFCDC youth programs training bumper.";

const DESIGNATION_SLOTS = [
  "FOUNDER_FACE_REFERENCE",
  "FOUNDER_BODY_REFERENCE",
  "FOUNDER_VIDEO_REFERENCE",
  "FOUNDER_VOICE_REFERENCE",
  "OFFICIAL_GOLD_CIRCLE_LOGO",
  "OFFICIAL_TRANSPARENT_LOGO",
  "OFFICIAL_FONT",
  "OFFICIAL_ANIMATED_LOGO",
];

const GATE_FLOW = [
  "IDEA",
  "PLAN",
  "GENERATE",
  "BUILD",
  "DRAFT",
  "HQ_PREVIEW",
  "FOUNDER_REVISION",
  "FOUNDER_APPROVAL",
  "MASTER",
  "DISTRIBUTION_AUTHORIZATION",
];

export default function AuraResolvePage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [instruction, setInstruction] = useState(SAMPLE);
  const [revisionNote, setRevisionNote] = useState("Make a YouTube version — keep everything else the same");
  const [libraryQuery, setLibraryQuery] = useState("youth training logo");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [revisionPlan, setRevisionPlan] = useState<Record<string, unknown> | null>(null);
  const [selectedAsset, setSelectedAsset] = useState("");
  const [selectedPreviewId, setSelectedPreviewId] = useState("");
  const [finalApproved, setFinalApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null);
  const [designateSlot, setDesignateSlot] = useState(DESIGNATION_SLOTS[0]);
  const [designateNote, setDesignateNote] = useState("");

  async function load() {
    const response = await fetch("/api/hq/aura/resolve/status", { credentials: "include" });
    if (!response.ok) {
      setBoard({ message: "HQ could not load the Resolve board." });
      return;
    }
    const body = await response.json();
    setBoard(body);
    if (!selectedAsset && body.assets?.[0]?.name) setSelectedAsset(body.assets[0].name);
    if (!selectedPreviewId && body.previews?.[0]?.id) setSelectedPreviewId(body.previews[0].id);
  }

  async function loadProviders() {
    const response = await fetch("/api/hq/aura/resolve/providers", { credentials: "include" });
    if (!response.ok) return;
    const body = await response.json();
    setProviders(body.discovery || body);
  }

  useEffect(() => {
    void load();
    void loadProviders();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  const previews = board?.previews || [];
  const latestPreview = useMemo(() => {
    if (selectedPreviewId) return previews.find((p) => p.id === selectedPreviewId) || previews[0] || null;
    return previews[0] || null;
  }, [previews, selectedPreviewId]);
  const last = board?.lastSuccessfulCommand;
  const lastLabel = last && "command" in last ? last.command : "none";
  const gate = board?.gate || "IDEA";
  const gateStates = board?.gateStates || GATE_FLOW;
  const kitSlots = board?.productionKitSlots?.slots || board?.brandKit?.productionKitSlots?.slots || [];
  const assetGaps = (plan?.ASSET_GAPS as Array<{ label?: string; capability?: string; status?: string; blocker?: string }> | undefined) || [];
  const libraryMatches = (plan?.LIBRARY_SEARCH as { matches?: Array<{ name?: string; category?: string; pathHint?: string }>; matchCount?: number } | undefined);
  const continuity = (plan?.CONTINUITY as Record<string, unknown> | undefined) || board?.continuity || null;
  const pipelineStages = ((plan?.PIPELINE as { stages?: string[] } | undefined)?.stages) || board?.pipeline?.stages || [];

  async function planInstruction() {
    setBusy(true);
    setNote("Building the IFCDC PRODUCTION plan…");
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

  async function runCloudGenerate(capability: string) {
    setBusy(true);
    setNote(`Requesting ${capability} from configured provider…`);
    try {
      const response = await fetch("/api/hq/aura/resolve/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability,
          title: "IFCDC youth programs",
          subtitle: "Training bumper",
          prompt:
            capability === "voice_generation"
              ? undefined
              : "Non-person abstract IFCDC still: gold geometric shapes on deep black, no people, no faces.",
          text:
            capability === "voice_generation"
              ? "IFCDC PRODUCTIONS presents a youth programs training bumper. This voice is synthetic."
              : undefined,
          publish: false,
        }),
      });
      const body = await response.json();
      setNote(
        body.ok
          ? `${capability} ok · job ${body.jobId || "—"} · file ${body.fileName || "—"} · then Start production for Resolve draft`
          : body.blocker || body.message || body.error || "Generation refused",
      );
      void loadProviders();
    } finally {
      setBusy(false);
    }
  }

  async function designateFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setDesignateNote("Reading file for designation…");
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const response = await fetch("/api/hq/aura/resolve/founder-identity/designate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotId: designateSlot,
          base64,
          originalName: file.name,
          mimeType: file.type || null,
          publish: false,
        }),
      });
      const body = await response.json();
      setDesignateNote(body.message || body.error || (body.ok ? "Designation queued." : "Designation refused."));
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
        body: JSON.stringify({
          instruction,
          revisionNote,
          projectName: String(plan?.project || "IFCDC-AURA-BARBERS-PROMO-P4"),
          publish: false,
        }),
      });
      const body = await response.json();
      setRevisionPlan(body.revision || null);
      setNote(body.message || (body.ok ? "Revision queued." : body.error || "Revision refused."));
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function masterFormats() {
    setBusy(true);
    setNote("Queuing multi-format masters from the accepted Barbers promo…");
    try {
      const response = await fetch("/api/hq/aura/resolve/master-formats", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceProject: "IFCDC-AURA-BARBERS-PROMO-V1",
          projectName: "IFCDC-AURA-BARBERS-PROMO-P4",
          publish: false,
        }),
      });
      const body = await response.json();
      setNote(body.message || (body.ok ? "Masters queued." : body.error || "Mastering refused."));
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
    setNote("Final render stays gated. DISTRIBUTION_AUTHORIZATION / publish remains blocked without an explicit Founder approval flag. Aura may NOT publish.");
  }

  return (
    <section className="aura-resolve-page">
      <style>{`
        .aura-resolve-page {
          display:grid; gap:0.85rem; max-width:720px; margin:0 auto; padding:0 0.25rem 2rem;
          width:100%; box-sizing:border-box;
        }
        .aura-resolve-page h1 { margin:0; font-size:clamp(1.4rem, 5vw, 1.9rem); letter-spacing:0.02em; }
        .aura-company { color:#C9A227; font-weight:700; font-size:0.85rem; letter-spacing:0.08em; text-transform:uppercase; }
        .aura-status-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0.55rem; }
        @media (min-width:640px) { .aura-status-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
        .aura-card {
          border:1px solid rgba(201,162,39,0.35); border-radius:14px; padding:0.85rem;
          background:linear-gradient(160deg, rgba(20,16,8,0.92), rgba(8,8,8,0.88));
        }
        .aura-actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
        .aura-actions .hq-btn { flex:1 1 140px; min-height:48px; font-size:0.95rem; }
        .aura-resolve-page textarea, .aura-resolve-page select, .aura-resolve-page input[type="text"] {
          width:100%; margin-top:8px; min-height:48px; border-radius:12px; border:1px solid rgba(201,162,39,0.35);
          background:rgba(0,0,0,0.35); color:inherit; padding:0.75rem; box-sizing:border-box; font-size:16px;
        }
        .aura-resolve-page textarea { min-height:120px; resize:vertical; }
        .aura-preview video { width:100%; max-height:70vh; border-radius:12px; background:#000; }
        .aura-muted { opacity:0.8; font-size:0.88rem; }
        .aura-pill {
          display:inline-block; padding:0.2rem 0.55rem; border-radius:999px;
          border:1px solid rgba(201,162,39,0.45); font-size:0.72rem; margin-right:0.35rem; margin-top:0.35rem;
        }
        .aura-gate {
          display:flex; flex-wrap:nowrap; gap:0.25rem; overflow-x:auto; -webkit-overflow-scrolling:touch;
          padding-bottom:0.25rem;
        }
        .aura-gate span {
          flex:0 0 auto; font-size:0.65rem; padding:0.35rem 0.45rem; border-radius:8px;
          border:1px solid rgba(255,255,255,0.12); opacity:0.55; white-space:nowrap;
        }
        .aura-gate span.on { opacity:1; border-color:#C9A227; color:#C9A227; font-weight:700; }
        .aura-preview-list { display:flex; gap:0.4rem; overflow-x:auto; padding:0.35rem 0; }
        .aura-preview-list button {
          flex:0 0 auto; min-height:44px; border-radius:10px; border:1px solid rgba(201,162,39,0.35);
          background:rgba(0,0,0,0.35); color:inherit; padding:0.45rem 0.65rem; font-size:0.75rem;
        }
        .aura-preview-list button.active { border-color:#C9A227; color:#C9A227; }
      `}</style>

      <header>
        <div className="aura-company">{board?.productionCompany || board?.company || "IFCDC PRODUCTIONS"}</div>
        <h1>AURA Video Production</h1>
        <p className="hq-kpi-meta" style={{ margin: "0.25rem 0 0" }}>
          Phone control · Production Mac executes · publish stays off · Phase 6 provider router
        </p>
        <div style={{ marginTop: 8 }}>
          <span className="aura-pill">identity:{board?.productionIdentity || "IFCDC PRODUCTION"}</span>
          {board?.brandPromoted ? <span className="aura-pill">brand:{board.brandPromoted}</span> : null}
          <span className="aura-pill">phase:{board?.phase || 6}</span>
        </div>
      </header>

      <div className="aura-card">
        <div className="hq-kpi-meta">Generative providers (discovery)</div>
        <p className="aura-muted" style={{ margin: "6px 0 0" }}>
          CREDENTIAL_PRESENT / MODEL_ACCESS only — no secret values. Cursor not required once a provider exists.
        </p>
        <div style={{ marginTop: 8 }}>
          {(((providers as { providers?: Array<Record<string, unknown>> } | null)?.providers) || []).slice(0, 6).map((p) => (
            <div key={String(p.PROVIDER_NAME)} style={{ marginTop: 6 }}>
              <strong>{String(p.PROVIDER_NAME)}</strong>
              <div className="aura-muted">
                CREDENTIAL_PRESENT={String(p.CREDENTIAL_PRESENT)} · INTEGRATION_STATUS={String(p.INTEGRATION_STATUS)}
              </div>
            </div>
          ))}
          {!providers ? <p className="aura-muted">Loading provider inventory…</p> : null}
        </div>
        <div className="aura-actions" style={{ marginTop: 10 }}>
          <button type="button" className="hq-btn" disabled={busy} onClick={() => void loadProviders()}>Refresh providers</button>
          <button type="button" className="hq-btn" disabled={busy} onClick={() => void runCloudGenerate("image_generation")}>
            Prove image (HQ)
          </button>
          <button type="button" className="hq-btn" disabled={busy} onClick={() => void runCloudGenerate("voice_generation")}>
            Prove synthetic voice (HQ)
          </button>
        </div>
      </div>

      <div className="aura-card">
        <div className="hq-kpi-meta">Founder identity onboarding</div>
        <p className="aura-muted" style={{ margin: "6px 0 0" }}>
          Explicit designation only. Never auto-designates existing files. Never overwrites originals. No face/voice generation.
        </p>
        <p style={{ margin: "8px 0 0" }}>
          FOUNDATION_MEDIA_MISSING:{" "}
          {String(
            board?.founderIdentity?.FOUNDATION_MEDIA_MISSING ??
              board?.clonePrep?.foundationMediaMissing ??
              true,
          )}
        </p>
        <div style={{ marginTop: 8 }}>
          {(board?.founderIdentity?.designations?.slots || []).map((slot) => (
            <span key={slot.id} className="aura-pill">{slot.id}:{slot.status}</span>
          ))}
        </div>
        <div className="hq-kpi-meta" style={{ marginTop: 12 }}>Designate slot</div>
        <select value={designateSlot} onChange={(event) => setDesignateSlot(event.target.value)}>
          {DESIGNATION_SLOTS.map((slot) => (
            <option key={slot} value={slot}>{slot}</option>
          ))}
        </select>
        <input
          type="file"
          style={{ marginTop: 8, width: "100%" }}
          disabled={busy}
          onChange={(event) => void designateFile(event.target.files?.[0] || null)}
        />
        {designateNote ? <p className="aura-muted" style={{ marginTop: 8 }}>{designateNote}</p> : null}
      </div>

      <div className="aura-card">
        <div className="hq-kpi-meta">Approval gate</div>
        <div className="aura-gate" style={{ marginTop: 8 }}>
          {gateStates.map((state) => (
            <span key={state} className={state === gate ? "on" : undefined}>{state.replace(/_/g, " ")}</span>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <span className="aura-pill">publish:{String(board?.publish ?? false)}</span>
          <span className="aura-pill">Aura may NOT publish</span>
          <span className="aura-pill">distribution blocked</span>
        </div>
      </div>

      <div className="aura-status-grid">
        {[
          ["Bridge", board?.bridge],
          ["Resolve", board?.resolve],
          ["Production Mac", board?.productionMac],
          ["Project", board?.project || "none"],
          ["Render", board?.renderStatus || "idle"],
          ["Progress", board?.renderPercent == null ? "—" : `${board.renderPercent}%`],
        ].map(([label, value]) => (
          <div key={label} className="aura-card">
            <div className="hq-kpi-meta">{label}</div>
            <div style={{ fontWeight: 700, marginTop: 4, wordBreak: "break-word" }}>{value || "OFFLINE"}</div>
          </div>
        ))}
      </div>

      <p style={{ margin: 0 }}>{note || board?.message}</p>

      <div className="aura-card">
        <div className="hq-kpi-meta">Idea</div>
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
          <button type="button" className="hq-btn" disabled={busy} onClick={() => void masterFormats()}>
            Master 9:16 · 16:9 · 1:1
          </button>
        </div>
      </div>

      <div className="aura-card">
        <div className="hq-kpi-meta">Library search (search-before-generate)</div>
        <input type="text" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search categories…" />
        <p className="aura-muted" style={{ margin: "8px 0 0" }}>
          Categories: {(board?.assetLibrary?.categories || ["Founder", "IFCDC", "Youth", "Templates", "Generated Images"]).slice(0, 8).join(" · ")}
          {board?.assetLibrary?.count != null ? ` · indexed ${board.assetLibrary.count}` : ""}
        </p>
        {libraryMatches?.matches?.length ? (
          <div style={{ marginTop: 8 }}>
            {libraryMatches.matches.slice(0, 6).map((m) => (
              <div key={`${m.category}-${m.name}`} className="aura-muted">{m.category}: {m.name}</div>
            ))}
          </div>
        ) : (
          <p className="aura-muted">Plan an idea to run live library search on the Production Mac.</p>
        )}
      </div>

      {assetGaps.length || plan?.GENERATION ? (
        <div className="aura-card">
          <div className="hq-kpi-meta">Asset gaps / generation status</div>
          {assetGaps.length ? assetGaps.map((gap) => (
            <div key={`${gap.capability}-${gap.label}`} style={{ marginTop: 6 }}>
              <strong>{gap.label || gap.capability}</strong>
              <div className="aura-muted">{gap.status || gap.blocker || gap.capability}</div>
            </div>
          )) : (
            <p className="aura-muted">No gaps listed on this plan.</p>
          )}
          <div style={{ marginTop: 8 }}>
            {Object.entries((plan?.GENERATION as { capabilities?: Record<string, { status?: string }> } | undefined)?.capabilities || board?.generation?.capabilities || {}).slice(0, 8).map(([key, value]) => (
              <span key={key} className="aura-pill">{key}:{value?.status || "—"}</span>
            ))}
          </div>
        </div>
      ) : null}

      {pipelineStages.length ? (
        <div className="aura-card">
          <div className="hq-kpi-meta">Idea → production pipeline</div>
          <div className="aura-gate" style={{ marginTop: 8 }}>
            {pipelineStages.map((stage) => (
              <span key={stage} className={stage === ((plan?.PIPELINE as { currentStage?: string })?.currentStage || board?.pipeline?.currentStage) ? "on" : undefined}>
                {stage.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {continuity ? (
        <div className="aura-card">
          <div className="hq-kpi-meta">Continuity</div>
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            <div><strong>Aspect:</strong> {String((continuity as { aspectRatio?: string }).aspectRatio || "—")}</div>
            <div><strong>Brand promoted:</strong> {String((continuity as { brand?: { brandPromoted?: string } }).brand?.brandPromoted || "—")}</div>
            <div><strong>Founder clone:</strong> {String((continuity as { characterIdentity?: { founderClone?: boolean } }).characterIdentity?.founderClone ?? false)}</div>
            <div className="aura-muted">Wardrobe / lighting / camera / voice locked fields persist on the project.</div>
          </div>
        </div>
      ) : null}

      <div className="aura-card">
        <div className="hq-kpi-meta">Revision / format follow-up</div>
        <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} rows={3} />
        <p className="aura-muted" style={{ margin: "8px 0 0" }}>
          Examples: darker scene · wardrobe · location · camera angle · smoother transition · replace generated clip · music harder · duck under voice · smooth fade · TikTok version · YouTube version · keep everything else the same
        </p>
        <div className="aura-actions" style={{ marginTop: 8 }}>
          <button type="button" className="hq-btn" disabled={busy} onClick={() => void requestRevision()}>
            Request revision
          </button>
        </div>
        {revisionPlan ? (
          <div style={{ marginTop: 8 }}>
            <span className="aura-pill">intents:{(revisionPlan.intents as string[] | undefined)?.join(",") || "—"}</span>
            <span className="aura-pill">
              dry:{(revisionPlan.dryModificationPlan as { executableWithoutGenerator?: boolean } | undefined)?.executableWithoutGenerator ? "executable" : "may need generator"}
            </span>
          </div>
        ) : null}
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
        <div className="hq-kpi-meta">HQ preview / masters</div>
        {previews.length ? (
          <div className="aura-preview-list">
            {previews.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === latestPreview?.id ? "active" : undefined}
                onClick={() => setSelectedPreviewId(item.id)}
              >
                {item.name.replace(/\.mp4$/i, "")}
                {item.duration != null ? ` · ${Number(item.duration).toFixed(1)}s` : ""}
              </button>
            ))}
          </div>
        ) : null}
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
          <p className="aura-muted">No HQ draft yet. Plan → Start production for a generative bumper, or Master formats from the accepted promo.</p>
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

      {plan ? (
        <div className="aura-card">
          <div className="hq-kpi-meta">Creative director plan</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {[
              ["PRODUCTION COMPANY", plan.productionCompany || plan.company || "IFCDC PRODUCTIONS"],
              ["PRODUCTION IDENTITY", plan.productionIdentity || "IFCDC PRODUCTION"],
              ["BRAND PROMOTED", plan.brandPromoted || "—"],
              ["PROJECT TITLE", plan.projectTitle || "—"],
              ["CONCEPT", plan.CONCEPT],
              ["PURPOSE", plan.PURPOSE],
              ["AUDIENCE", plan.AUDIENCE],
              ["DURATION", plan.DURATION],
              ["FORMAT", plan.FORMAT],
              ["PROJECT", plan.project],
              ["CTA", plan.CTA],
              ["CREDITS", (plan.PRODUCTION_CREDITS as { line?: string } | undefined)?.line || "AN IFCDC PRODUCTION"],
              ["BRANDING", plan.BRANDING],
              ["MUSIC", plan.MUSIC],
              ["TRANSITIONS", plan.TRANSITIONS],
              ["ENDING", plan.ENDING],
              ["RENDER", plan.RENDER_FORMAT],
              ["PHASE", plan.phase || 5],
            ].map(([label, value]) => (
              <div key={String(label)}><strong>{label}:</strong> {String(value || "—")}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="aura-status-grid">
        <List title="Production kit slots" lines={
          kitSlots.length
            ? kitSlots.map((s) => `${s.label}: ${s.status}${s.pathHint ? ` · ${s.pathHint}` : ""}`)
            : [
                board?.productionCompany || board?.brandKit?.company || "IFCDC PRODUCTIONS",
                board?.brandKit?.productionKitItems != null ? `${board.brandKit.productionKitItems} kit templates` : "syncing…",
              ]
        } />
        <List title="Completed renders (Mac)" lines={(board?.completedRenders || []).map((file) => file.name)} />
        <List title="HQ preview history" lines={previews.map((item) => `${item.name}${item.duration != null ? ` (${Number(item.duration).toFixed(1)}s)` : ""}`)} />
        <List title="Creative memory" lines={(board?.creativeMemory || []).map((item) => `${item.kind} · ${item.createdAt || ""}`)} />
        <List title="Clone / Founder library" lines={Object.entries(board?.clonePrep || {}).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).slice(0, 10)} />
        <List title="Notes" lines={board?.notes || []} />
        <List title="Errors" lines={board?.errors || []} />
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
