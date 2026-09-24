import React, { useEffect, useState } from "react";

type Job = { id: string; command: string; status: string; createdAt?: string; result?: { ok?: boolean; error?: string } | null };
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
  errors?: string[];
  notes?: string[];
  lastHeartbeat?: string | null;
  lastSuccessfulCommand?: { command?: string; at?: string } | Job | null;
  message?: string;
};

const CONTROLS: { command: string; label: string; payload?: Record<string, unknown>; ask?: string }[] = [
  { command: "create_project", label: "Create project", ask: "Project name", payload: {} },
  { command: "open_project", label: "Open project", ask: "Project name" },
  { command: "import_media", label: "Import media", ask: "Media path" },
  { command: "create_timeline", label: "Create timeline", ask: "Timeline name" },
  { command: "add_clip", label: "Add clip", ask: "Clip name" },
  { command: "add_title", label: "Add title", ask: "Title name" },
  { command: "add_logo", label: "Add logo", ask: "Logo path" },
  { command: "add_music", label: "Add music", ask: "Music path" },
  { command: "add_voiceover", label: "Add voiceover", ask: "Voiceover path" },
  { command: "add_transition", label: "Add transition" },
  { command: "fade_audio", label: "Fade audio" },
  { command: "fade_video", label: "Fade video" },
  { command: "save_project", label: "Save project" },
  { command: "preview_project", label: "Preview project" },
  { command: "queue_render", label: "Queue render" },
  { command: "render_vertical", label: "Render vertical" },
  { command: "render_landscape", label: "Render landscape" },
];

const SAMPLE =
  "Aura, create a 30-second IFCDC Barbers App commercial using the approved media and branding.";

function payloadFor(control: (typeof CONTROLS)[number], value: string) {
  if (control.command === "create_project" || control.command === "open_project") return { name: value };
  if (control.command === "import_media" || control.command === "add_logo" || control.command === "add_music" || control.command === "add_voiceover") {
    return { path: value };
  }
  if (control.command === "create_timeline") return { name: value };
  if (control.command === "add_clip") return { mediaName: value };
  if (control.command === "add_title") return { titleName: value || "Text" };
  if (control.command === "render_vertical") return { width: 1080, height: 1920 };
  if (control.command === "render_landscape") return { width: 1920, height: 1080 };
  return {};
}

export default function AuraResolvePage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [instruction, setInstruction] = useState(SAMPLE);
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState("");

  async function load() {
    const response = await fetch("/api/hq/aura/resolve/status", { credentials: "include" });
    if (!response.ok) {
      setBoard({ message: "HQ could not load the Resolve board." });
      return;
    }
    setBoard(await response.json());
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  async function run(command: string, payload: Record<string, unknown>) {
    setNote(`Queuing ${command} for the production Mac.`);
    const response = await fetch("/api/hq/aura/resolve/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, payload }),
    });
    const body = await response.json();
    setNote(body.ok ? `${command} is in the HQ queue.` : body.error || "Queue refused the command.");
    void load();
  }

  async function onControl(control: (typeof CONTROLS)[number]) {
    const value = control.ask ? window.prompt(control.ask) || "" : "";
    if (control.ask && !value && control.command !== "add_title") return;
    await run(control.command, payloadFor(control, value));
  }

  async function cancel(id: string) {
    await fetch(`/api/hq/aura/resolve/jobs/${id}/cancel`, { method: "POST", credentials: "include" });
    void load();
  }

  async function planInstruction() {
    setNote("Translating the instruction into a plan.");
    const response = await fetch("/api/hq/aura/resolve/plan", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    const body = await response.json();
    setPlan(JSON.stringify(body.plan || body, null, 2));
    setNote(body.message || "Plan queued.");
    void load();
  }

  const last = board?.lastSuccessfulCommand;
  const lastLabel = last && "command" in last ? last.command : "none";

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <header>
        <h1 style={{ margin: 0 }}>AURA Video Production</h1>
        <p className="hq-kpi-meta" style={{ margin: "0.25rem 0 0" }}>DaVinci Resolve · Founder control. The local bridge stays on this Mac.</p>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        {[
          ["AURA Resolve Bridge", board?.bridge],
          ["DaVinci Resolve", board?.resolve],
          ["Resolve version", board?.resolveVersion || "—"],
          ["Production Mac", board?.productionMac],
          ["Current project", board?.project || "none"],
          ["Current timeline", board?.timeline || "none"],
          ["Render status", board?.renderStatus || "idle"],
          ["Render progress", board?.renderPercent == null ? "—" : `${board.renderPercent}%`],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid rgba(201,162,39,0.35)", borderRadius: 12, padding: "0.8rem" }}>
            <div className="hq-kpi-meta">{label}</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{value || "OFFLINE"}</div>
          </div>
        ))}
      </div>
      <p style={{ margin: 0 }}>{note || board?.message}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CONTROLS.map((control) => (
          <button key={control.command} type="button" className="hq-btn" onClick={() => void onControl(control)}>
            {control.label}
          </button>
        ))}
      </div>
      <div>
        <div className="hq-kpi-meta">AURA production command</div>
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={4} style={{ width: "100%", marginTop: 8 }} />
        <button type="button" className="hq-btn hq-btn-primary" onClick={() => void planInstruction()}>
          Queue plan
        </button>
      </div>
      {plan ? <pre style={{ whiteSpace: "pre-wrap" }}>{plan}</pre> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem" }}>
        <List title="Current job" lines={board?.currentJob ? [`${board.currentJob.command} · ${board.currentJob.status}`] : ["none"]} />
        <List title="Queue" lines={(board?.queue || []).map((job) => `${job.command} · ${job.status}`)} actionLabel="Cancel queued job" onAction={(line) => {
          const job = (board?.queue || []).find((item) => line.startsWith(item.command) && item.status === "queued");
          if (job) void cancel(job.id);
        }} />
        <List title="Media / assets" lines={(board?.assets || []).map((asset) => asset.name)} />
        <List title="Completed renders" lines={(board?.completedRenders || []).map((file) => file.name)} />
        <List title="Errors" lines={board?.errors || []} />
        <List title="AURA production notes" lines={board?.notes || []} />
        <List title="Last heartbeat" lines={[board?.lastHeartbeat || "none"]} />
        <List title="Last successful command" lines={[lastLabel || "none"]} />
      </div>
    </section>
  );
}

function List({ title, lines, actionLabel, onAction }: { title: string; lines: string[]; actionLabel?: string; onAction?: (line: string) => void }) {
  const shown = lines.length ? lines : ["none"];
  return (
    <div style={{ border: "1px solid rgba(201,162,39,0.25)", borderRadius: 12, padding: "0.8rem" }}>
      <div className="hq-kpi-meta">{title}</div>
      {shown.map((line) => (
        <div key={line} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
          <span>{line}</span>
          {actionLabel && line !== "none" && line.endsWith("queued") ? (
            <button type="button" className="hq-btn" onClick={() => onAction?.(line)}>{actionLabel}</button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
