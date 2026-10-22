import { withOpenAiCredentialFallback } from "../lib/openaiConfig";
import { PackageDraftError, preparePackageDraft, type DraftSource } from "./auraPackageDraft";
import { logHqAudit } from "./hqAuditLog";

const active = new Set<string>();
async function githubJson(endpoint: string, token: string) {
  const response = await fetch(`https://api.github.com/repos/IFCDC9/IFCDC/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "IFCDC-AURA-draft" },
    redirect: "error", signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404 && endpoint.startsWith("contents/")) return null;
  if (!response.ok) throw new PackageDraftError(502, "GitHub source access failed. Check HQ repository access.");
  const reader = response.body?.getReader();
  if (!reader) throw new PackageDraftError(502, "GitHub returned no source snapshot.");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 300_000) throw new PackageDraftError(413, "Selected source exceeds the draft limit.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function readDraftSources(paths: string[]) {
  const token = (process.env.GITHUB_TOKEN || "").trim();
  if (!token) throw new PackageDraftError(503, "HQ needs GitHub read access to prepare changes.");
  const head = await githubJson("branches/main", token);
  const baseCommit = head?.commit?.sha;
  if (typeof baseCommit !== "string" || !/^[a-f0-9]{40}$/.test(baseCommit)) {
    throw new PackageDraftError(502, "Could not identify the current main commit.");
  }
  const sources: DraftSource[] = [];
  for (const path of paths) {
    const file = await githubJson(`contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${baseCommit}`, token);
    if (file === null) { sources.push({ path, content: null }); continue; }
    if (file.type !== "file" || file.target || file.submodule_git_url || file.encoding !== "base64" ||
        typeof file.size !== "number" || file.size > 60_000 || typeof file.content !== "string" ||
        file.content.length > 85_000 || !/^[A-Za-z0-9+/=\r\n]*$/.test(file.content)) {
      throw new PackageDraftError(413, "Select smaller regular UTF-8 source files.");
    }
    const data = Buffer.from(file.content, "base64");
    const content = data.toString("utf8");
    if (content.includes("\0") || !Buffer.from(content).equals(data) || data.length !== file.size) {
      throw new PackageDraftError(400, "Selected source is not regular UTF-8 text.");
    }
    sources.push({ path, content });
  }
  return { baseCommit, sources };
}

export async function draftRunnerChangePackage(input: unknown, requesterId: string) {
  if (active.has(requesterId) || active.size >= 4) throw new PackageDraftError(409, "A draft is already being prepared. Wait for it to finish.");
  active.add(requesterId);
  try {
    const draft = await preparePackageDraft(input, {
      readSources: readDraftSources,
      generate: async (messages) => {
        try {
          const signal = AbortSignal.timeout(65_000);
          const { result } = await withOpenAiCredentialFallback((_creds, client) => client.chat.completions.create({
            model: process.env.AURA_MODEL || "gpt-4o-mini", response_format: { type: "json_object" },
            max_tokens: 8000, messages,
          }, { timeout: 60_000, maxRetries: 0, signal }));
          if (result.choices[0]?.finish_reason !== "stop" || !result.choices[0]?.message.content) {
            throw new Error("Incomplete draft");
          }
          return result.choices[0].message.content;
        } catch { throw new PackageDraftError(502, "AURA could not prepare a complete draft. Check model access or try a smaller task."); }
      },
    });
    await logHqAudit({ action: "aura_runner_change_drafted", entityType: "aura_runner",
      entityId: draft.review.packageSha256, actorId: requesterId,
      metadata: { baseCommit: draft.changePackage.baseCommit, fileCount: draft.changePackage.files.length,
        testsRun: false, productionExecuted: false } });
    return draft;
  } catch (error) {
    if (error instanceof PackageDraftError) throw error;
    throw new PackageDraftError(502, "Could not read the selected source snapshot. No changes were queued.");
  } finally { active.delete(requesterId); }
}
