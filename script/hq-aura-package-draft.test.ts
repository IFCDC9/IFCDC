import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { validateDraftInput, preparePackageDraft, bindDraftOutput } from "../server/hq/auraPackageDraft.ts";
import { readDraftSources } from "../server/hq/auraPackageDraftProviders.ts";

const baseCommit = "a".repeat(40);
const path = "client/src/components/hq/grants/GrantSubNav.tsx";
const source = { path, content: "export const label = 'Old';\n" };
const changed = "export const label = 'New';\n";
const output = JSON.stringify({ summary: "Update label", files: [{ path, content: changed }] });

test("instructions become an exact-base package using source hashes, without executing it", async () => {
  const calls: string[] = [];
  const draft = await preparePackageDraft({ instruction: "Update the label", paths: [path] }, {
    readSources: async (paths) => { calls.push("read"); assert.deepEqual(paths, [path]); return { baseCommit, sources: [source] }; },
    generate: async (messages) => {
      calls.push("generate");
      const context = JSON.parse(messages[1].content);
      assert.equal(context.sources[0].content, source.content);
      assert.equal(context.baseCommit, baseCommit);
      assert.match(messages[0].content, /untrusted data/);
      return output;
    },
  });
  assert.deepEqual(calls, ["read", "generate"]);
  assert.equal(draft.changePackage.baseCommit, baseCommit);
  assert.equal(draft.changePackage.files[0].beforeSha256, crypto.createHash("sha256").update(source.content).digest("hex"));
  assert.equal(draft.changePackage.files[0].content, changed);
  assert.equal(draft.review.packageSha256.length, 64);
  assert.equal(draft.testsRun, false);
  assert.equal(draft.productionExecuted, false);
});

test("protected paths, extra fields, duplicate paths and excessive requests fail before reading or generating", async () => {
  for (const input of [
    { instruction: "", paths: [path] },
    { instruction: "x", paths: ["server/auth.ts"] },
    { instruction: "x", paths: ["Documents/../escape.md"] },
    { instruction: "x", paths: [".env"] },
    { instruction: "x", paths: ["script/aura-mac-runner.mjs"] },
    { instruction: "x", paths: [path, path.toUpperCase()] },
    { instruction: "x", paths: Array.from({ length: 6 }, (_, n) => `Documents/file${n}.md`) },
    { instruction: "x", paths: [path], command: "anything" },
  ]) {
    assert.throws(() => validateDraftInput(input));
    await assert.rejects(preparePackageDraft(input, {
      readSources: async () => { assert.fail("must not read"); },
      generate: async () => { assert.fail("must not generate"); },
    }));
  }
});

test("model output cannot alter scope, source digests, package base or inject command fields", () => {
  for (const value of ["not JSON", JSON.stringify({ summary: "x", files: [] }),
    JSON.stringify({ summary: "x", files: [{ path: "Documents/other.md", content: "x" }] }),
    JSON.stringify({ summary: "x", files: [{ path, content: changed, beforeSha256: null }] }),
    JSON.stringify({ summary: "x", files: [{ path, content: changed }], command: "anything" }),
    JSON.stringify({ summary: "x", files: [{ path, content: source.content }] }),
    JSON.stringify({ summary: "x", files: [{ path, content: changed }, { path, content: changed }] }),
    JSON.stringify({ summary: "x", files: [{ path, content: "x".repeat(250_001) }] }),
  ]) assert.throws(() => bindDraftOutput(value, baseCommit, [source]));
  const created = bindDraftOutput(output, baseCommit, [{ path, content: null }]);
  assert.equal(created.files[0].beforeSha256, null);
});

test("incomplete, duplicated, oversized and invalid-base source snapshots never reach the model", async () => {
  for (const snapshot of [
    { baseCommit: "main", sources: [source] }, { baseCommit, sources: [] },
    { baseCommit, sources: [{ path: "Documents/other.md", content: "x" }] },
    { baseCommit, sources: [{ path, content: "x".repeat(60_001) }] },
  ]) await assert.rejects(preparePackageDraft({ instruction: "x", paths: [path] }, {
    readSources: async () => snapshot,
    generate: async () => { assert.fail("must not generate"); },
  }));
});

test("GitHub reader pins every content request to one commit and refuses links and non-UTF8", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "fixture-token-not-a-real-credential";
  let mode = "valid";
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    const target = String(url); requests.push(target);
    assert.equal(options?.redirect, "error");
    if (target.endsWith("branches/main")) return Response.json({ commit: { sha: baseCommit } });
    assert.ok(target.endsWith(`?ref=${baseCommit}`));
    if (mode === "missing") return new Response("", { status: 404 });
    if (mode === "denied") return new Response("", { status: 403 });
    const data = mode === "binary" ? Buffer.from([255]) : Buffer.from(source.content);
    return Response.json({ type: "file", encoding: "base64", content: data.toString("base64"), size: data.length,
      ...(mode === "link" ? { target: "private.txt" } : {}) });
  }) as typeof fetch;
  try {
    assert.deepEqual(await readDraftSources([path]), { baseCommit, sources: [source] });
    assert.equal(requests.length, 2);
    mode = "missing";
    assert.equal((await readDraftSources([path])).sources[0].content, null);
    for (const invalid of ["link", "binary", "denied"]) {
      mode = invalid;
      await assert.rejects(readDraftSources([path]));
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
});
