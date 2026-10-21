import crypto from "node:crypto";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fail = () => { throw new Error("Invalid change package."); };
const keysAre = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

export function validateChangePackage(input) {
  if (!keysAre(input, ["version", "repository", "baseCommit", "summary", "files"]) ||
      input.version !== 1 || input.repository !== "IFCDC9/IFCDC" ||
      !/^[a-f0-9]{40}$/.test(input.baseCommit) || typeof input.summary !== "string" ||
      !input.summary.trim() || input.summary.length > 1000 || !Array.isArray(input.files) ||
      !input.files.length || input.files.length > 25) fail();
  const paths = new Set();
  const files = input.files.map((file) => {
    if (!keysAre(file, ["path", "beforeSha256", "content"]) || typeof file.path !== "string" ||
        typeof file.content !== "string" || file.content.includes("\0") ||
        !(file.beforeSha256 === null || /^[a-f0-9]{64}$/.test(file.beforeSha256))) fail();
    // Portable regular text files only. No deletions, links, executables, configuration or secrets.
    const parts = file.path.split("/");
    if (!/^(client\/src\/|server\/|shared\/|script\/|Documents\/)/.test(file.path) ||
        !/\.(?:ts|tsx|js|jsx|mjs|cjs|md|txt|css)$/.test(file.path) ||
        parts.some((part) => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) || /[.]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
        /(?:secret|credential|private.?key|runner|change.?package|auth|permission|policy|migration)/i.test(file.path) ||
        /(?:^|\/)(?:node_modules|dist|build|coverage)(?:\/|$)/i.test(file.path)) fail();
    const portablePath = file.path.toLowerCase();
    if (paths.has(portablePath)) fail();
    paths.add(portablePath);
    return { path: file.path, beforeSha256: file.beforeSha256, content: file.content };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const normalized = { version: 1, repository: input.repository, baseCommit: input.baseCommit,
    summary: input.summary, files };
  if (Buffer.byteLength(JSON.stringify(normalized)) > 250_000) fail();
  return normalized;
}

export function reviewChangePackage(input) {
  const value = validateChangePackage(input);
  return { packageSha256: hash(JSON.stringify(value)), repository: value.repository,
    baseCommit: value.baseCommit, summary: value.summary,
    files: value.files.map((file) => ({ path: file.path, operation: file.beforeSha256 === null ? "create" : "modify",
      beforeSha256: file.beforeSha256, afterSha256: hash(file.content), bytes: Buffer.byteLength(file.content) })),
    testsRun: false, productionExecuted: false };
}
