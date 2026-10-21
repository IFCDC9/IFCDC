import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { reviewChangePackage, stageChangePackage } from "./aura-change-package.mjs";

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aura-package-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, "init");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  git(root, "remote", "add", "origin", "https://github.com/IFCDC9/IFCDC.git");
  fs.mkdirSync(path.join(root, "Documents"));
  fs.writeFileSync(path.join(root, "Documents/note.md"), "original\n");
  git(root, "add", "."); git(root, "commit", "-m", "fixture");
  const value = { version: 1, repository: "IFCDC9/IFCDC", baseCommit: git(root, "rev-parse", "HEAD"),
    summary: "Update note", files: [{ path: "Documents/note.md", beforeSha256: sha("original\n"), content: "reviewed\n" }] };
  const stage = (pkg = value, reviewedSha256 = reviewChangePackage(pkg).packageSha256) =>
    stageChangePackage({ repoRoot: root, changePackage: pkg, reviewedSha256 });
  return { root, value, stage };
}

test("staging creates an independent review diff and preserves the original checkout", async (t) => {
  const { root, value, stage } = fixture(t);
  value.files.push({ path: "Documents/new.md", beforeSha256: null, content: "new note\n" });
  const originalHead = git(root, "rev-parse", "HEAD");
  const result = await stage();
  t.after(() => fs.rmSync(path.dirname(result.workspace), { recursive: true, force: true }));
  assert.equal(result.status, "staged_for_review");
  assert.equal(fs.readFileSync(path.join(result.workspace, "Documents/note.md"), "utf8"), "reviewed\n");
  assert.match(fs.readFileSync(result.patchPath, "utf8"), /\+reviewed/);
  assert.match(fs.readFileSync(result.patchPath, "utf8"), /\+new note/);
  assert.equal(fs.readFileSync(path.join(root, "Documents/note.md"), "utf8"), "original\n");
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.equal(git(root, "rev-parse", "HEAD"), originalHead);
  assert.equal(git(result.workspace, "rev-parse", "HEAD"), originalHead);
  assert.equal(result.testsRun, false);
  assert.equal(result.productionExecuted, false);
});

test("review digest binds all content and rejects changes after review", async (t) => {
  const { value, stage } = fixture(t);
  const digest = reviewChangePackage(value).packageSha256;
  value.files[0].content = "changed after review";
  await assert.rejects(stage(value, digest), /reviewed SHA-256/);
});

test("refuses dirty, stale, child-folder and unapproved repositories", async (t) => {
  const { root, value, stage } = fixture(t);
  await assert.rejects(stage({ ...value, baseCommit: "0".repeat(40) }), /exact package base/);
  await assert.rejects(stageChangePackage({ repoRoot: path.join(root, "Documents"), changePackage: value,
    reviewedSha256: reviewChangePackage(value).packageSha256 }), /approved repository/);
  fs.writeFileSync(path.join(root, "untracked.txt"), "work");
  await assert.rejects(stage(), /clean/);
  fs.unlinkSync(path.join(root, "untracked.txt"));
  git(root, "remote", "set-url", "origin", "https://github.com/other/repo.git");
  await assert.rejects(stage(), /approved repository/);
});

test("original content hashes and create-only targets are enforced", async (t) => {
  const { value, stage } = fixture(t);
  value.files[0].beforeSha256 = "0".repeat(64);
  await assert.rejects(stage(), /original content/);
  value.files[0].beforeSha256 = null;
  await assert.rejects(stage(), /original content/);
});

test("rejects command fields, traversal, secret/config paths, portable collisions and excess size", (t) => {
  const { value } = fixture(t);
  assert.throws(() => reviewChangePackage({ ...value, testCommand: "npm run deploy" }));
  for (const target of ["../escape.md", "Documents/../escape.md", "Documents/CON.txt", "Documents/a.md.",
    "Documents/link\\escape.md", "Documents/.env", ".github/workflows/ci.js", "server/auth.ts", "script/aura-mac-runner.mjs"]) {
    assert.throws(() => reviewChangePackage({ ...value, files: [{ ...value.files[0], path: target }] }), target);
  }
  assert.throws(() => reviewChangePackage({ ...value, files: [value.files[0], { ...value.files[0], path: "Documents/NOTE.md" }] }));
  assert.throws(() => reviewChangePackage({ ...value, files: [{ ...value.files[0], content: "x".repeat(250_001) }] }));
});

test("refuses symlink ancestors without writing outside the workspace", { skip: process.platform === "win32" }, async (t) => {
  const { root, value, stage } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aura-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, "Documents/link"));
  git(root, "add", "."); git(root, "commit", "-m", "symlink fixture");
  value.baseCommit = git(root, "rev-parse", "HEAD");
  value.files = [{ path: "Documents/link/escape.md", beforeSha256: null, content: "escape" }];
  await assert.rejects(stage(), /symlink ancestors/);
  assert.equal(fs.existsSync(path.join(outside, "escape.md")), false);
});
