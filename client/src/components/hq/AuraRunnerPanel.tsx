import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hqApiFetch } from "../../api/hqApiFetch";

type Runner = { id: string; label: string; revoked_at: number | null; last_seen_at: number | null };
type Job = { id: string; runner_id: string; status: string; result: {
  commit?: string; branch?: string | null; changedFiles?: number; untrackedFiles?: number; error?: string;
} | null };
const base = "/api/hq/aura/software-engineering";
const post = <T,>(endpoint: string, body = {}) => hqApiFetch<T>(base + endpoint, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export default function AuraRunnerPanel() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("Founder Mac");
  const [repoRoot, setRepoRoot] = useState("");
  const [enrollment, setEnrollment] = useState<{ id: string; token: string } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["aura-runners"] });
  const runners = useQuery({ queryKey: ["aura-runners"], queryFn: () => hqApiFetch<{ runners: Runner[]; jobs: Job[] }>(base + "/runners"),
    refetchInterval: 15_000, retry: false });
  const enroll = useMutation({ mutationFn: () => post<{ id: string; token: string }>("/runners", { label }),
    onSuccess: (result) => { setEnrollment(result); setMessage("Runner registered. Download its private configuration on the Mac; keep it confidential."); refresh(); },
    onError: (error: Error) => setMessage(error.message) });
  const inspect = useMutation({ mutationFn: (runnerId: string) => post("/runner-jobs", { runnerId, kind: "inspect_repository" }),
    onSuccess: () => { setMessage("Inspection queued. It will wait until the registered runner connects."); refresh(); },
    onError: (error: Error) => setMessage(error.message) });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/runners/${id}/revoke`),
    onSuccess: (_, id) => { if (enrollment?.id === id) setEnrollment(null); setMessage("Runner access revoked; pending inspections cancelled."); refresh(); },
    onError: (error: Error) => setMessage(error.message) });
  function downloadConfig() {
    if (!enrollment || !repoRoot.startsWith("/")) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ hqUrl: window.location.origin,
      runnerToken: enrollment.token, repoRoot }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "aura-runner.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return <section>
    <h3>Mac runner connection</h3>
    <p>Register a Mac and request a read-only repository inspection. This connection does not edit code or deploy.</p>
    {runners.isError && <p role="alert">Runner access unavailable: {runners.error.message}</p>}
    <form onSubmit={(event) => { event.preventDefault(); enroll.mutate(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input className="hq-input" aria-label="Runner name" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} required />
      <button className="hq-btn" disabled={enroll.isPending || !!enrollment}>Register runner</button>
    </form>
    {enrollment && <div>
      <p>The credential is available in this session only. Revoking the runner invalidates it.</p>
      <input className="hq-input" aria-label="Repository folder on the Mac" placeholder="Full path to the HQ repository on your Mac" value={repoRoot} onChange={(event) => setRepoRoot(event.target.value)} />
      <button className="hq-btn" onClick={downloadConfig} disabled={!repoRoot.startsWith("/")}>Download private configuration</button>
    </div>}
    {message && <p role="status">{message}</p>}
    <ul>{runners.data?.runners.map((runner) => <li key={runner.id} style={{ marginBottom: 12 }}>
      <strong>{runner.label}</strong> — {runner.revoked_at ? "Revoked" : runner.last_seen_at ? `Last contact ${new Date(runner.last_seen_at).toLocaleString()}` : "Not connected yet"}
      {!runner.revoked_at && <>
        {" "}<button className="hq-btn" disabled={inspect.isPending} onClick={() => inspect.mutate(runner.id)}>Inspect repository</button>
        {" "}<button className="hq-btn" disabled={revoke.isPending} onClick={() => revoke.mutate(runner.id)}>Revoke access</button>
      </>}
    </li>)}</ul>
    <ul>{runners.data?.jobs.slice(0, 10).map((job) => <li key={job.id}>
      Repository inspection: {job.status}
      {job.result?.commit && <span> — runner reported commit {job.result.commit.slice(0, 7)}, {job.result.changedFiles} changed files, {job.result.untrackedFiles} untracked files</span>}
      {job.result?.error && <span> — {job.result.error}</span>}
    </li>)}</ul>
  </section>;
}
