/**
 * GitHub integration — repository health, commit tracking, and deployment verification.
 */
import { getBuildInfo } from "../buildInfo";

const GITHUB_API = "https://api.github.com";
const DEFAULT_OWNER = "IFCDC9";
const DEFAULT_REPO = "IFCDC";
const DEFAULT_BRANCH = "main";
const PROBE_TIMEOUT_MS = 3_000;

export type GitHubDeploymentStatus = "aligned" | "behind" | "ahead" | "unknown";
export type GitHubRepositoryHealth = "healthy" | "degraded" | "unavailable";

export type GitHubIntegrationSnapshot = {
  repository: string;
  branch: string;
  latestCommit: string | null;
  latestCommitFull: string | null;
  latestCommitAt: string | null;
  lastPushAt: string | null;
  repositoryHealth: GitHubRepositoryHealth;
  deploymentStatus: GitHubDeploymentStatus;
  liveCommit: string | null;
  defaultBranch: string | null;
  archived: boolean;
  apiReachable: boolean;
  latencyMs?: number;
  message: string;
  /** How the probe authenticated. Public read is valid for IFCDC9/IFCDC. */
  tokenStatus?: "accepted" | "absent" | "rejected";
};

export type GitHubIntegrationDetail = {
  label: string;
  value: string;
  status?: "success" | "warning" | "muted" | "danger";
};

function githubOwner(): string {
  return (process.env.GITHUB_OWNER || DEFAULT_OWNER).trim();
}

function githubRepo(): string {
  return (process.env.GITHUB_REPO || DEFAULT_REPO).trim();
}

function githubBranch(): string {
  return (process.env.GITHUB_BRANCH || DEFAULT_BRANCH).trim();
}

function githubToken(): string | null {
  const token = (process.env.GITHUB_TOKEN || "").trim();
  return token || null;
}

function githubHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "IFCDC-Headquarters",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function liveDeployCommit(): string | null {
  const render = process.env.RENDER_GIT_COMMIT?.trim();
  if (render) return render.slice(0, 7);
  const built = getBuildInfo().commit?.trim();
  return built ? built.slice(0, 7) : null;
}

function compareDeployment(githubSha: string | null, liveSha: string | null): GitHubDeploymentStatus {
  if (!githubSha || !liveSha) return "unknown";
  const gh = githubSha.slice(0, 7);
  const live = liveSha.slice(0, 7);
  if (gh === live) return "aligned";
  // Render deploys from GitHub — live behind means production not yet on latest main
  return "behind";
}

function repositoryHealthFromRepo(repo: {
  archived?: boolean;
  disabled?: boolean;
  default_branch?: string;
} | null, branch: string, apiOk: boolean): GitHubRepositoryHealth {
  if (!apiOk || !repo) return "unavailable";
  if (repo.archived || repo.disabled) return "degraded";
  if (repo.default_branch && repo.default_branch !== branch) return "degraded";
  return "healthy";
}

function deploymentLabel(status: GitHubDeploymentStatus, live: string | null, github: string | null): string {
  switch (status) {
    case "aligned":
      return live ? `Aligned with Render (${live})` : "Aligned with production deploy";
    case "behind":
      return live && github ? `Render (${live}) behind GitHub (${github})` : "Production may need redeploy";
    case "ahead":
      return "Production ahead of tracked branch";
    default:
      return "Deploy commit unknown — check Render dashboard";
  }
}

function healthLabel(health: GitHubRepositoryHealth): string {
  switch (health) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    default:
      return "Unavailable";
  }
}

export function buildGitHubDetails(snapshot: GitHubIntegrationSnapshot): GitHubIntegrationDetail[] {
  return [
    { label: "Connected repository", value: snapshot.repository, status: snapshot.apiReachable ? "success" : "muted" },
    { label: "Active branch", value: snapshot.branch, status: "success" },
    {
      label: "Latest commit hash",
      value: snapshot.latestCommit ?? "—",
      status: snapshot.latestCommit ? "success" : "warning",
    },
    {
      label: "Last successful push",
      value: snapshot.lastPushAt ? new Date(snapshot.lastPushAt).toLocaleString() : "—",
      status: snapshot.lastPushAt ? "success" : "muted",
    },
    {
      label: "Repository health",
      value: healthLabel(snapshot.repositoryHealth),
      status:
        snapshot.repositoryHealth === "healthy"
          ? "success"
          : snapshot.repositoryHealth === "degraded"
            ? "warning"
            : "danger",
    },
    {
      label: "Deployment status",
      value: deploymentLabel(snapshot.deploymentStatus, snapshot.liveCommit, snapshot.latestCommit),
      status:
        snapshot.deploymentStatus === "aligned"
          ? "success"
          : snapshot.deploymentStatus === "behind"
            ? "warning"
            : "muted",
    },
  ];
}

async function githubFetch<T>(path: string, token: string | null): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data };
}

type GithubRepoPayload = {
  full_name: string;
  default_branch: string;
  pushed_at: string;
  archived: boolean;
  disabled: boolean;
};

type GithubCommitPayload = {
  sha: string;
  commit: { author?: { date?: string }; committer?: { date?: string } };
};

function unavailableSnapshot(
  fullName: string,
  branch: string,
  message: string,
  tokenStatus: GitHubIntegrationSnapshot["tokenStatus"],
  latencyMs?: number,
  apiReachable = false
): GitHubIntegrationSnapshot {
  return {
    repository: fullName,
    branch,
    latestCommit: null,
    latestCommitFull: null,
    latestCommitAt: null,
    lastPushAt: null,
    repositoryHealth: "unavailable",
    deploymentStatus: "unknown",
    liveCommit: liveDeployCommit(),
    defaultBranch: null,
    archived: false,
    apiReachable,
    latencyMs,
    message,
    tokenStatus,
  };
}

function snapshotFromProbe(
  fullName: string,
  branch: string,
  repoRes: { ok: boolean; status: number; data: GithubRepoPayload | null },
  commitRes: { ok: boolean; data: GithubCommitPayload | null },
  rateRes: { ok: boolean },
  latencyMs: number,
  tokenStatus: NonNullable<GitHubIntegrationSnapshot["tokenStatus"]>,
  note?: string
): GitHubIntegrationSnapshot {
  if (!repoRes.ok) {
    const authHint = repoRes.status === 401 ? " — token invalid or expired" : repoRes.status === 404 ? " — repo not found or no access" : "";
    return unavailableSnapshot(
      fullName,
      branch,
      `GitHub API error ${repoRes.status}${authHint}${note ? ` · ${note}` : ""}`,
      tokenStatus,
      latencyMs,
      rateRes.ok
    );
  }

  const repoData = repoRes.data;
  const commitData = commitRes.data;
  const latestCommitFull = commitData?.sha ?? null;
  const latestCommit = latestCommitFull?.slice(0, 7) ?? null;
  const latestCommitAt =
    commitData?.commit?.committer?.date ?? commitData?.commit?.author?.date ?? null;
  const lastPushAt = repoData?.pushed_at ?? latestCommitAt;
  const liveCommit = liveDeployCommit();
  const deploymentStatus = compareDeployment(latestCommitFull, liveCommit);
  const repositoryHealth = repositoryHealthFromRepo(repoData, branch, repoRes.ok);
  const healthMsg =
    repositoryHealth === "healthy" && deploymentStatus === "aligned"
      ? `GitHub connected · ${fullName}@${branch} · deploy aligned (${latestCommit})`
      : repositoryHealth === "healthy"
        ? `GitHub connected · ${fullName}@${branch} · ${deploymentLabel(deploymentStatus, liveCommit, latestCommit)}`
        : `GitHub ${healthLabel(repositoryHealth).toLowerCase()} · ${fullName}`;

  return {
    repository: repoData?.full_name ?? fullName,
    branch,
    latestCommit,
    latestCommitFull,
    latestCommitAt,
    lastPushAt,
    repositoryHealth,
    deploymentStatus,
    liveCommit,
    defaultBranch: repoData?.default_branch ?? null,
    archived: Boolean(repoData?.archived),
    apiReachable: rateRes.ok || repoRes.ok,
    latencyMs,
    message: note ? `${healthMsg} · ${note}` : healthMsg,
    tokenStatus,
  };
}

async function probeGithub(owner: string, repo: string, branch: string, token: string | null) {
  const started = Date.now();
  const [repoRes, commitRes, rateRes] = await Promise.all([
    githubFetch<GithubRepoPayload>(`/repos/${owner}/${repo}`, token),
    githubFetch<GithubCommitPayload>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token),
    githubFetch<{ rate?: { remaining?: number } }>(`/rate_limit`, token),
  ]);
  return { repoRes, commitRes, rateRes, latencyMs: Date.now() - started };
}

export async function fetchGitHubIntegrationSnapshot(): Promise<GitHubIntegrationSnapshot> {
  const owner = githubOwner();
  const repo = githubRepo();
  const branch = githubBranch();
  const fullName = `${owner}/${repo}`;
  const token = githubToken();

  try {
    if (!token) {
      const pub = await probeGithub(owner, repo, branch, null);
      return snapshotFromProbe(
        fullName,
        branch,
        pub.repoRes,
        pub.commitRes,
        pub.rateRes,
        pub.latencyMs,
        "absent",
        pub.repoRes.ok ? "public API (GITHUB_TOKEN absent)" : "GITHUB_TOKEN not set on Render"
      );
    }

    const authed = await probeGithub(owner, repo, branch, token);
    if (authed.repoRes.ok) {
      return snapshotFromProbe(
        fullName,
        branch,
        authed.repoRes,
        authed.commitRes,
        authed.rateRes,
        authed.latencyMs,
        "accepted"
      );
    }

    // A bad Authorization header makes GitHub reject even public repos. Retry anonymously.
    const pub = await probeGithub(owner, repo, branch, null);
    if (pub.repoRes.ok) {
      return snapshotFromProbe(
        fullName,
        branch,
        pub.repoRes,
        pub.commitRes,
        pub.rateRes,
        authed.latencyMs + pub.latencyMs,
        "rejected",
        `GITHUB_TOKEN rejected (HTTP ${authed.repoRes.status}); public API used`
      );
    }

    return snapshotFromProbe(
      fullName,
      branch,
      authed.repoRes,
      authed.commitRes,
      authed.rateRes,
      authed.latencyMs,
      "rejected",
      "public API also failed"
    );
  } catch (err) {
    return unavailableSnapshot(
      fullName,
      branch,
      err instanceof Error ? err.message : "GitHub probe failed",
      token ? "rejected" : "absent"
    );
  }
}

export function resolveGitHubHubStatus(
  snapshot: GitHubIntegrationSnapshot,
  tokenConfigured: boolean
): "connected" | "configured" | "degraded" | "not_configured" {
  if (snapshot.repositoryHealth === "healthy" && snapshot.apiReachable && snapshot.latestCommit) {
    return "connected";
  }
  if (!tokenConfigured && !snapshot.apiReachable) return "not_configured";
  if (!snapshot.apiReachable || snapshot.repositoryHealth === "unavailable") return "degraded";
  if (snapshot.apiReachable) return "configured";
  return "degraded";
}

export async function testGitHubIntegrationLive() {
  const snapshot = await fetchGitHubIntegrationSnapshot();
  const tokenConfigured = Boolean(githubToken());
  const status = resolveGitHubHubStatus(snapshot, tokenConfigured);
  const success = status === "connected" || (status === "configured" && snapshot.apiReachable);

  return {
    success,
    message: snapshot.message,
    provider: "github",
    status,
    testedAt: new Date().toISOString(),
    details: buildGitHubDetails(snapshot),
    snapshot: {
      repository: snapshot.repository,
      branch: snapshot.branch,
      latestCommit: snapshot.latestCommit,
      lastPushAt: snapshot.lastPushAt,
      repositoryHealth: snapshot.repositoryHealth,
      deploymentStatus: snapshot.deploymentStatus,
      liveCommit: snapshot.liveCommit,
    },
  };
}
