/** Publish only a Founder-approved, exactly tested navigation package as a DRAFT PR. */
import crypto from 'node:crypto';
import { runnerDatabase, RunnerBridgeError } from './auraRunnerBridge';
import { reviewChangePackage, validateChangePackage } from '../../shared/auraChangePackage.mjs';
import { GRANT_NAV_PROFILE, GRANT_NAV_PATH, applicationTestScope } from '../../shared/auraTestProfiles.mjs';
import { logHqAudit } from './hqAuditLog';

const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex');

export async function publishTestedPullRequest(input: unknown, requesterId: string) {
  const value = input as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'approved,reviewedSha256,testJobId' || value.approved !== true ||
      typeof value.testJobId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.testJobId) ||
      typeof value.reviewedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewedSha256)) {
    throw new RunnerBridgeError(400, 'Approve the exact passing application test result before publishing a draft PR.');
  }
  const db = await runnerDatabase();
  const row = await db.get(`SELECT j.result_json, p.package_json, p.package_sha256 FROM aura_runner_jobs j
    JOIN aura_runner_change_payloads p ON p.job_id = j.id
    JOIN aura_runner_test_requests t ON t.job_id = j.id
    JOIN aura_runner_devices r ON r.id = j.runner_id
    WHERE j.id = ? AND j.kind = 'test_change_package_v1' AND j.status = 'succeeded'
    AND t.test_profile = 'grant-subnav-v1' AND r.revoked_at IS NULL`, value.testJobId);
  if (!row || row.package_sha256 !== value.reviewedSha256) {
    throw new RunnerBridgeError(409, 'A passing application test for this exact package on an active runner is required.');
  }
  const changePackage = validateChangePackage(JSON.parse(row.package_json));
  const review = reviewChangePackage(changePackage);
  const receipt = JSON.parse(row.result_json || '{}');
  if (!applicationTestScope(changePackage) || review.packageSha256 !== value.reviewedSha256 ||
      receipt.packageSha256 !== review.packageSha256 || receipt.baseCommit !== changePackage.baseCommit ||
      receipt.testProfile !== GRANT_NAV_PROFILE || receipt.testsRun !== true || receipt.outcome !== 'passed' ||
      receipt.exitCode !== 0 || receipt.productionExecuted !== false) {
    throw new RunnerBridgeError(409, 'Application test receipt does not match the package.');
  }
  const previous = await db.get('SELECT status, url, branch FROM aura_runner_pull_requests WHERE test_job_id = ? OR package_sha256 = ?', value.testJobId, review.packageSha256);
  if (previous) {
    if (previous.status === 'published') return previous;
    throw new RunnerBridgeError(409, `A PR attempt already exists for branch ${previous.branch}. Inspect GitHub before retrying; its outcome may be uncertain.`);
  }
  const token = (process.env.AURA_GITHUB_PR_TOKEN || '').trim();
  if (!token) throw new RunnerBridgeError(503, 'Configure AURA_GITHUB_PR_TOKEN with Contents and Pull requests write access to IFCDC9/IFCDC.');
  async function github(endpoint: string, body?: unknown): Promise<any> {
    const response = await fetch(`https://api.github.com/repos/IFCDC9/IFCDC/${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'IFCDC-AURA-review' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error('github_request_failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('github_response_missing');
    const chunks: Buffer[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 500_000) throw new Error('github_response_limit');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  // Complete read-only preflight before reserving a single, non-retried write attempt.
  let baseTree: string;
  try {
    const main = await github('branches/main');
    if (main?.commit?.sha !== changePackage.baseCommit) throw new RunnerBridgeError(409, 'Main moved since this package was drafted. Prepare and test a fresh package.');
    const original = await github(`contents/${GRANT_NAV_PATH}?ref=${changePackage.baseCommit}`);
    if (original.type !== 'file' || original.target || original.submodule_git_url || original.encoding !== 'base64' ||
        typeof original.content !== 'string' || original.content.length > 340_000 ||
        !/^[A-Za-z0-9+/=\r\n]*$/.test(original.content)) throw new Error('source_refused');
    const bytes = Buffer.from(original.content, 'base64');
    if (bytes.length !== original.size || digest(bytes) !== changePackage.files[0].beforeSha256 ||
        bytes.equals(Buffer.from(changePackage.files[0].content))) throw new RunnerBridgeError(409, 'Source content does not match the reviewed change.');
    const base = await github(`git/commits/${changePackage.baseCommit}`);
    if (!sha(base?.tree?.sha)) throw new Error('tree_missing');
    baseTree = base.tree.sha;
  } catch (error) {
    if (error instanceof RunnerBridgeError) throw error;
    throw new RunnerBridgeError(502, 'GitHub preflight failed. Check repository access. No publishing attempt was started.');
  }
  const branch = 'aura/review-' + crypto.randomUUID();
  const reserved = await db.run(`INSERT OR IGNORE INTO aura_runner_pull_requests
    (test_job_id, package_sha256, base_commit, branch, status, created_at) VALUES (?, ?, ?, ?, 'creating', ?)`,
    value.testJobId, review.packageSha256, changePackage.baseCommit, branch, Date.now());
  if (!reserved.changes) throw new RunnerBridgeError(409, 'A publishing attempt already exists for this test result.');
  let url: string;
  try {
    const blob = await github('git/blobs', { content: changePackage.files[0].content, encoding: 'utf-8' });
    if (!sha(blob?.sha)) throw new Error('blob_missing');
    const tree = await github('git/trees', { base_tree: baseTree, tree: [{ path: GRANT_NAV_PATH, mode: '100644', type: 'blob', sha: blob.sha }] });
    if (!sha(tree?.sha)) throw new Error('tree_missing');
    const title = 'AURA: ' + changePackage.summary.replace(/[\r\n]/g, ' ').slice(0, 110);
    const commit = await github('git/commits', { message: title, tree: tree.sha, parents: [changePackage.baseCommit] });
    if (!sha(commit?.sha)) throw new Error('commit_missing');
    await github('git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
    const pr = await github('pulls', { title, head: branch, base: 'main', draft: true,
      body: `Proposed navigation change for Founder review.\n\nPackage SHA-256: ${review.packageSha256}\nBase: ${changePackage.baseCommit}\nTest job: ${value.testJobId}\n\nValidation: grant-subnav-v1 passed (four DOM checks: navigation labels, click callback, active state, and form behavior). This does not validate the full Grants Center, grant APIs, production behavior, or a complete build.\n\nFounder explicitly approved publishing this exact package. Merge and deployment require separate approval.` });
    if (pr.draft !== true || typeof pr.html_url !== 'string' || !/^https:\/\/github\.com\/IFCDC9\/IFCDC\/pull\/\d+$/.test(pr.html_url)) throw new Error('pr_response_refused');
    url = pr.html_url;
    await db.run("UPDATE aura_runner_pull_requests SET status = 'published', url = ? WHERE test_job_id = ?", url, value.testJobId);
  } catch {
    await db.run("UPDATE aura_runner_pull_requests SET status = 'uncertain' WHERE test_job_id = ?", value.testJobId);
    throw new RunnerBridgeError(502, `Publishing did not confirm completion. Inspect GitHub branch ${branch} before retrying. Main was not changed by this workflow.`);
  }
  await logHqAudit({ action: 'aura_runner_draft_pr_published', entityType: 'aura_runner', entityId: value.testJobId,
    actorId: requesterId, metadata: { packageSha256: review.packageSha256, branch, url, productionExecuted: false } });
  return { status: 'published', branch, url };
}
