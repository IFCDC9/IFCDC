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

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "IFCDC-Headquarters",
  };
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

async function githubFetch<T>(path: string, token: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data };
}

export async function fetchGitHubIntegrationSnapshot(): Promise<GitHubIntegrationSnapshot> {
  const owner = githubOwner();
  const repo = githubRepo();
  const branch = githubBranch();
  const fullName = `${owner}/${repo}`;
  const token = githubToken();

  if (!token) {
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
      apiReachable: false,
      message: "GITHUB_TOKEN not set on Render",
    };
  }

  const started = Date.now();
  try {
    const [repoRes, commitRes, rateRes] = await Promise.all([
      githubFetch<{
        full_name: string;
        default_branch: string;
        pushed_at: string;
        archived: boolean;
        disabled: boolean;
      }>(`/repos/${owner}/${repo}`, token),
      githubFetch<{
        sha: string;
        commit: { author?: { date?: string }; committer?: { date?: string } };
      }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token),
      githubFetch<{ rate?: { remaining?: number } }>(`/rate_limit`, token),
    ]);

    const latencyMs = Date.now() - started;
    const apiReachable = rateRes.ok || repoRes.ok;
    const repoData = repoRes.data;
    const commitData = commitRes.data;

    if (!repoRes.ok) {
      const authHint = repoRes.status === 401 ? " — token invalid or expired" : repoRes.status === 404 ? " — repo not found or no access" : "";
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
        message: `GitHub API error ${repoRes.status}${authHint}`,
      };
    }

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
      apiReachable,
      latencyMs,
      message: healthMsg,
    };
  } catch (err) {
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
      apiReachable: false,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : "GitHub probe failed",
    };
  }
}

export function resolveGitHubHubStatus(
  snapshot: GitHubIntegrationSnapshot,
  tokenConfigured: boolean
): "connected" | "configured" | "degraded" | "not_configured" {
  if (!tokenConfigured) return "not_configured";
  if (!snapshot.apiReachable || snapshot.repositoryHealth === "unavailable") return "degraded";
  if (snapshot.repositoryHealth === "healthy" && snapshot.latestCommit) return "connected";
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
