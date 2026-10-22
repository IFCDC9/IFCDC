import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hqApiFetch } from "../../api/hqApiFetch";

type Runner = { id: string; label: string; revoked_at: number | null; last_seen_at: number | null };
type Job = { id: string; runner_id: string; kind: string; status: string; result: {
  commit?: string; branch?: string | null; changedFiles?: number; untrackedFiles?: number; error?: string;
  testProfile?: string; outcome?: string; exitCode?: number; durationMs?: number; testsRun?: boolean | null;
  packageSha256?: string; fileCount?: number; reviewId?: string;
} | null };
type PullRequest = { test_job_id: string; package_sha256: string; status: string; branch: string; url: string | null };
type PackageReview = { packageSha256: string; baseCommit: string; summary: string;
  files: { path: string; operation: string; afterSha256: string; bytes: number }[] };
const base = "/api/hq/aura/software-engineering";
const post = <T,>(endpoint: string, body = {}, timeoutMs = 20_000) => hqApiFetch<T>(base + endpoint, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs,
});

export default function AuraRunnerPanel() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("Founder Mac");
  const [repoRoot, setRepoRoot] = useState("");
  const [enrollment, setEnrollment] = useState<{ id: string; token: string } | null>(null);
  const [message, setMessage] = useState("");
  const [packageText, setPackageText] = useState("");
  const [draftInstruction, setDraftInstruction] = useState("");
  const [draftPaths, setDraftPaths] = useState("");
  const draftRevision = useRef(0);
  const [selectedRunner, setSelectedRunner] = useState("");
  const [testJobId, setTestJobId] = useState("");
  const [testProfile, setTestProfile] = useState("package-validator-v1");
  const [publishTestId, setPublishTestId] = useState("");
  const [publishApproved, setPublishApproved] = useState(false);
  const [testApproved, setTestApproved] = useState(false);
  const [approved, setApproved] = useState(false);
  const [review, setReview] = useState<{ source: string; data: PackageReview } | null>(null);
  const validRepoPath = /^(?:\/|[A-Za-z]:[\\/])/.test(repoRoot.trim());
  const refresh = () => void qc.invalidateQueries({ queryKey: ["aura-runners"] });
  const draftPackage = useMutation({
    mutationFn: (request: { instruction: string; paths: string[]; revision: number }) =>
      post<{ changePackage: unknown }>("/runner-change-draft", { instruction: request.instruction, paths: request.paths }, 150_000),
    onSuccess: (result, request) => {
      if (draftRevision.current !== request.revision) {
        setMessage("Draft discarded because you changed the inputs while AURA was preparing it. Your current work is preserved.");
        return;
      }
      draftRevision.current++;
      setPackageText(JSON.stringify(result.changePackage, null, 2));
      setReview(null); setApproved(false); setSelectedRunner("");
      setMessage("AURA prepared a draft from the selected GitHub files. Validate and review it below before approving staging. No tests have run.");
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const runners = useQuery({ queryKey: ["aura-runners"], queryFn: () => hqApiFetch<{ runners: Runner[]; jobs: Job[]; pullRequests?: PullRequest[] }>(base + "/runners"),
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
  const testPackage = useMutation({ mutationFn: () => {
    const job = runners.data?.jobs.find((item) => item.id === testJobId && item.kind === "stage_change_package_v1" && item.status === "succeeded");
    if (!job?.result?.packageSha256 || !testApproved) throw new Error("Select and approve a successfully staged package first.");
    return post("/runner-test-jobs", { stagingJobId: job.id, reviewedSha256: job.result.packageSha256,
      testProfile, approved: true });
  }, onSuccess: () => { setTestApproved(false); setMessage("Selected tests queued on the computer that staged this package. Results will appear above. The runner needs test execution enabled locally and a configured Docker image."); refresh(); },
  onError: (error: Error) => setMessage(error.message) });
  const publishPackage = useMutation({ mutationFn: () => {
    const job = runners.data?.jobs.find((item) => item.id === publishTestId && item.status === "succeeded" &&
      item.result?.testProfile === "grant-subnav-v1" && item.result.testsRun === true && item.result.exitCode === 0);
    if (!job?.result?.packageSha256 || !publishApproved) throw new Error("Select and approve a passing application test first.");
    return post<{ url: string }>("/runner-draft-pr", { testJobId: job.id,
      reviewedSha256: job.result.packageSha256, approved: true }, 150_000);
  }, onSuccess: () => { setPublishApproved(false); setMessage("Draft pull request published. Review its diff and CI before separately approving merge or deployment."); refresh(); },
  onError: (error: Error) => { setMessage(error.message); setPublishApproved(false); refresh(); } });
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
      {job.kind === "test_change_package_v1" ? "Package tests" : job.kind === "stage_change_package_v1" ? "Package staging" : "Repository inspection"}: {job.status}
      {job.result?.commit && <span> — runner reported commit {job.result.commit.slice(0, 7)}, {job.result.changedFiles} changed files, {job.result.untrackedFiles} untracked files</span>}
      {job.kind === "test_change_package_v1" && job.result && <span> — {job.result.testProfile}: {job.result.outcome};
        {job.result.testsRun === true ? ` exit ${job.result.exitCode}, ${job.result.durationMs} ms` : job.result.testsRun === false ? " tests did not start" : " execution uncertain; inspect locally before retrying"}.
        Package {job.result.packageSha256?.slice(0, 12)}. {job.result.testProfile === "grant-subnav-v1" ? "Four Grants navigation component checks; full Grants Center and build are not tested." : "This profile checks only package validation."}</span>}
      {job.result?.error && <span> — {job.result.error}</span>}
      {job.result?.reviewId && <span> — runner reported {job.result.fileCount} staged files; local review {job.result.reviewId}. Tests have not run.</span>}
    </li>)}</ul>
    <h4>Test a staged package</h4>
    <p>Package validator v1 runs four unit tests for package format, content digests and rejected paths.
      It does not test app screens, grants, builds, or other changed files. Tests run in a separate container
      with no network or connection credentials; your active checkout stays unchanged.</p>
    <p>Grant navigation v1 executes the proposed GrantSubNav.tsx component and checks four DOM behaviors.
      It accepts changes to that existing component only. It requires a separate application test image and local opt-in;
      it does not test the full Grants Center, grant APIs, or a production build.</p>
    <label>Test profile <select className="hq-input" aria-label="Package test profile" value={testProfile}
      onChange={(event) => { setTestProfile(event.target.value); setTestApproved(false); }}>
      <option value="package-validator-v1">Package integrity only</option>
      <option value="grant-subnav-v1">Grants navigation component</option>
    </select></label>
    <label>Staged package <select className="hq-input" aria-label="Staged package for tests" value={testJobId}
      onChange={(event) => { setTestJobId(event.target.value); setTestApproved(false); }}>
      <option value="">Choose a staged package</option>
      {runners.data?.jobs.filter((job) => job.kind === "stage_change_package_v1" && job.status === "succeeded" &&
        runners.data.runners.some((runner) => runner.id === job.runner_id && !runner.revoked_at)).map((job) => <option key={job.id} value={job.id}>
        {runners.data.runners.find((runner) => runner.id === job.runner_id)?.label} — {job.result?.packageSha256?.slice(0, 12)} — {job.result?.reviewId}
      </option>)}
    </select></label>
    {testJobId && <p>Approved package SHA-256: <code style={{ overflowWrap: "anywhere" }}>
      {runners.data?.jobs.find((job) => job.id === testJobId)?.result?.packageSha256}
    </code></p>}
    <p><label><input type="checkbox" checked={testApproved} onChange={(event) => setTestApproved(event.target.checked)} />
      I approve running {testProfile === "grant-subnav-v1" ? "the Grants navigation component tests" : "the package validator tests"} for this exact staged package on its computer.</label></p>
    <button className="hq-btn" disabled={!testApproved || !testJobId || testPackage.isPending}
      onClick={() => testPackage.mutate()}>Approve and queue package tests</button>
    <h4>Publish a tested change for review</h4>
    <p>Create a draft pull request for an approved package that passed Grants navigation component tests.
      This publishes the proposed file to GitHub. Merge and deployment require separate approval.</p>
    <label>Passing application test <select className="hq-input" aria-label="Passing application test for PR" value={publishTestId}
      onChange={(event) => { setPublishTestId(event.target.value); setPublishApproved(false); }}>
      <option value="">Choose a passing application test</option>
      {runners.data?.jobs.filter((job) => job.kind === "test_change_package_v1" && job.status === "succeeded" &&
        job.result?.testProfile === "grant-subnav-v1" && job.result.testsRun === true && job.result.exitCode === 0 &&
        runners.data.runners.some((runner) => runner.id === job.runner_id && !runner.revoked_at)).map((job) =>
        <option key={job.id} value={job.id}>{job.result?.packageSha256?.slice(0, 12)} — {job.result?.testProfile}</option>)}
    </select></label>
    {publishTestId && <p>Package SHA-256: <code style={{ overflowWrap: "anywhere" }}>
      {runners.data?.jobs.find((job) => job.id === publishTestId)?.result?.packageSha256}</code></p>}
    <p><label><input type="checkbox" checked={publishApproved} onChange={(event) => setPublishApproved(event.target.checked)} />
      I approve publishing this exact tested package as a draft pull request to IFCDC9/IFCDC.</label></p>
    <button className="hq-btn" disabled={!publishTestId || !publishApproved || publishPackage.isPending}
      onClick={() => publishPackage.mutate()}>Approve and publish draft PR</button>
    <ul>{runners.data?.pullRequests?.map((pr) => <li key={pr.test_job_id}>
      {pr.package_sha256.slice(0, 12)} — {pr.status}: {pr.url ? <a href={pr.url} target="_blank" rel="noreferrer">Open draft PR</a> :
        <span>{pr.branch} — inspect GitHub before retrying</span>}
    </li>)}</ul>
    <h4>Ask AURA to prepare changes</h4>
    <p>Describe a small fix and select up to five source files in IFCDC9/IFCDC (one repository path per line).
      AURA reads those files at the current main commit and drafts their replacement contents for your review.
      This uses HQ's configured AI provider. Drafting does not stage, test, commit, or deploy changes.</p>
    <label>Work instruction<textarea className="hq-input" aria-label="AURA change instruction" rows={3}
      style={{ width: "100%", boxSizing: "border-box" }} maxLength={4000} value={draftInstruction}
      placeholder="Describe the problem, expected behavior, and limits of the change"
      onChange={(event) => { draftRevision.current++; setDraftInstruction(event.target.value); }} /></label>
    <label>Source files<textarea className="hq-input" aria-label="Source files for AURA draft" rows={3}
      style={{ width: "100%", boxSizing: "border-box" }} maxLength={2000} value={draftPaths}
      placeholder="client/src/components/hq/grants/GrantSubNav.tsx"
      onChange={(event) => { draftRevision.current++; setDraftPaths(event.target.value); }} /></label>
    <button className="hq-btn" disabled={draftPackage.isPending || !draftInstruction.trim() || !draftPaths.trim()}
      onClick={() => draftPackage.mutate({ instruction: draftInstruction.trim(),
        paths: draftPaths.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), revision: draftRevision.current })}>
      {draftPackage.isPending ? "AURA is preparing a draft…" : "Draft changes for review"}
    </button>
    <h4>Review a change package</h4>
    <p>Upload a package JSON file or paste its contents. Review the complete file contents below before approving isolated staging on a computer.</p>
    <input type="file" accept=".json,application/json" aria-label="Upload change package" onChange={async (event) => {
      const file = event.target.files?.[0];
      draftRevision.current++;
      setReview(null); setApproved(false); setPackageText("");
      if (!file) return;
      if (file.size > 250_000) { setMessage("Package exceeds the 250,000-byte limit."); return; }
      try { setPackageText(await file.text()); } catch { setMessage("Could not read the selected package."); }
    }} />
    <textarea className="hq-input" aria-label="Change package JSON" rows={6} style={{ width: "100%", boxSizing: "border-box" }}
      value={packageText} onChange={(event) => { draftRevision.current++; setPackageText(event.target.value); setReview(null); setApproved(false); }} />
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
