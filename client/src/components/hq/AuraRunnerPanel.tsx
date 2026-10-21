import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hqApiFetch } from "../../api/hqApiFetch";

type Runner = { id: string; label: string; revoked_at: number | null; last_seen_at: number | null };
type Job = { id: string; runner_id: string; kind: string; status: string; result: {
  commit?: string; branch?: string | null; changedFiles?: number; untrackedFiles?: number; error?: string;
  packageSha256?: string; fileCount?: number; reviewId?: string;
} | null };
type PackageReview = { packageSha256: string; baseCommit: string; summary: string;
  files: { path: string; operation: string; afterSha256: string; bytes: number }[] };
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
  const [packageText, setPackageText] = useState("");
  const [selectedRunner, setSelectedRunner] = useState("");
  const [approved, setApproved] = useState(false);
  const [review, setReview] = useState<{ source: string; data: PackageReview } | null>(null);
  const validRepoPath = /^(?:\/|[A-Za-z]:[\\/])/.test(repoRoot.trim());
  const refresh = () => void qc.invalidateQueries({ queryKey: ["aura-runners"] });
  const runners = useQuery({ queryKey: ["aura-runners"], queryFn: () => hqApiFetch<{ runners: Runner[]; jobs: Job[] }>(base + "/runners"),
    refetchInterval: 15_000, retry: false });
  const enroll = useMutation({ mutationFn: () => post<{ id: string; token: string }>("/runners", { label }),
    onSuccess: (result) => { setEnrollment(result); setMessage("Runner registered. Download its private configuration on the selected computer; keep it confidential."); refresh(); },
    onError: (error: Error) => setMessage(error.message) });
  const inspect = useMutation({ mutationFn: (runnerId: string) => post("/runner-jobs", { runnerId, kind: "inspect_repository" }),
    onSuccess: () => { setMessage("Inspection queued. It will wait until the registered runner connects."); refresh(); },
    onError: (error: Error) => setMessage(error.message) });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/runners/${id}/revoke`),
    onSuccess: (_, id) => { if (enrollment?.id === id) setEnrollment(null); setMessage("Runner access revoked; pending inspections cancelled."); refresh(); },
    onError: (error: Error) => setMessage(error.message) });
  const reviewPackage = useMutation({ mutationFn: (source: string) => post<PackageReview>("/runner-change-review", { changePackage: JSON.parse(source) }),
    onSuccess: (data, source) => { setReview({ source, data }); setApproved(false); setMessage("Package validated. Review its contents and choose the computer before approving staging."); },
    onError: (error: Error) => { setReview(null); setMessage(error.message); } });
  const stagePackage = useMutation({ mutationFn: () => {
    if (!review || review.source !== packageText || !approved || !selectedRunner) throw new Error("Review and approve the current package first.");
    return post("/runner-change-jobs", { runnerId: selectedRunner, changePackage: JSON.parse(review.source),
      reviewedSha256: review.data.packageSha256, approved: true });
  }, onSuccess: () => { setApproved(false); setReview(null); setMessage("Staging queued for the selected computer. Its runner must have package staging enabled locally. No tests or deployment were requested."); refresh(); },
  onError: (error: Error) => setMessage(error.message) });
  function downloadConfig() {
    if (!enrollment || !validRepoPath) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ hqUrl: window.location.origin,
      runnerToken: enrollment.token, repoRoot: repoRoot.trim() }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "aura-runner.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return <section>
    <h3>Computer runner connection</h3>
    <p>Inspect an approved repository on your Mac or Dell. Updated runners can also stage a reviewed package in a separate workspace when enabled locally. Staging does not change your active checkout, run tests, or deploy.</p>
    {runners.isError && <p role="alert">Runner access unavailable: {runners.error.message}</p>}
    <form onSubmit={(event) => { event.preventDefault(); enroll.mutate(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input className="hq-input" aria-label="Runner name" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} required />
      <button className="hq-btn" disabled={enroll.isPending || !!enrollment}>Register runner</button>
    </form>
    {enrollment && <div>
      <p>The credential is available in this session only. Revoking the runner invalidates it.</p>
      <input className="hq-input" aria-label="Repository folder on this computer" placeholder="Full Mac or Windows path to the HQ repository" value={repoRoot} onChange={(event) => setRepoRoot(event.target.value)} />
      <button className="hq-btn" onClick={downloadConfig} disabled={!validRepoPath}>Download private configuration</button>
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
      {job.kind === "stage_change_package_v1" ? "Package staging" : "Repository inspection"}: {job.status}
      {job.result?.commit && <span> — runner reported commit {job.result.commit.slice(0, 7)}, {job.result.changedFiles} changed files, {job.result.untrackedFiles} untracked files</span>}
      {job.result?.error && <span> — {job.result.error}</span>}
      {job.result?.reviewId && <span> — runner reported {job.result.fileCount} staged files; local review {job.result.reviewId}. Tests have not run.</span>}
    </li>)}</ul>
    <h4>Review a change package</h4>
    <p>Upload a package JSON file or paste its contents. Review the complete file contents below before approving isolated staging on a computer.</p>
    <input type="file" accept=".json,application/json" aria-label="Upload change package" onChange={async (event) => {
      const file = event.target.files?.[0];
      setReview(null); setApproved(false); setPackageText("");
      if (!file) return;
      if (file.size > 250_000) { setMessage("Package exceeds the 250,000-byte limit."); return; }
      try { setPackageText(await file.text()); } catch { setMessage("Could not read the selected package."); }
    }} />
    <textarea className="hq-input" aria-label="Change package JSON" rows={6} style={{ width: "100%", boxSizing: "border-box" }}
      value={packageText} onChange={(event) => { setPackageText(event.target.value); setReview(null); setApproved(false); }} />
    <button className="hq-btn" disabled={reviewPackage.isPending || !packageText.trim() || new Blob([packageText]).size > 250_000}
      onClick={() => reviewPackage.mutate(packageText)}>Validate package for review</button>
    {review && review.source === packageText && <div>
      <p>{review.data.summary}</p>
      <p>Base commit: <code>{review.data.baseCommit}</code></p>
      <p>Package SHA-256: <code style={{ overflowWrap: "anywhere" }}>{review.data.packageSha256}</code></p>
      {review.data.files.map((file) => <details key={file.path}>
        <summary>{file.operation}: {file.path} ({file.bytes} bytes)</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 300, overflow: "auto" }}>
          {JSON.parse(review.source).files.find((item: { path: string }) => item.path === file.path)?.content}
        </pre>
      </details>)}
      <label>Computer for staging <select className="hq-input" aria-label="Computer for staging" value={selectedRunner}
        onChange={(event) => { setSelectedRunner(event.target.value); setApproved(false); }}>
        <option value="">Choose a computer</option>
        {runners.data?.runners.filter((runner) => !runner.revoked_at).map((runner) => <option key={runner.id} value={runner.id}>{runner.label}</option>)}
      </select></label>
      <p><label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I reviewed these file contents and approve staging this exact package on the selected computer.</label></p>
      <button className="hq-btn" disabled={!approved || !selectedRunner || stagePackage.isPending}
        onClick={() => stagePackage.mutate()}>Approve and queue isolated staging</button>
    </div>}
  </section>;
}
