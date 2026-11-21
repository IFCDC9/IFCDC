import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sqlite3 from "sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESOLVE_SOURCE = path.join(ROOT, "server/hq/auraResolveProductionNode.ts");

function listBackupNames(backupDir: string): string[] {
  return readdirSync(backupDir).sort();
}

function forceSqliteFullOnNodeWrites(): () => void {
  const proto = sqlite3.Database.prototype as sqlite3.Database & {
    run: (...args: unknown[]) => unknown;
  };
  const originalRun = proto.run;
  proto.run = function patchedRun(sql: unknown, ...rest: unknown[]) {
    const text = String(sql || "");
    if (
      /INSERT INTO aura_resolve_production_nodes/i.test(text) ||
      /UPDATE aura_resolve_production_nodes SET last_seen_at/i.test(text)
    ) {
      const err = Object.assign(new Error("SQLITE_FULL: database or disk is full"), {
        code: "SQLITE_FULL",
      });
      const cb = rest[rest.length - 1];
      if (typeof cb === "function") {
        queueMicrotask(() => (cb as (error: Error) => void)(err));
        return this;
      }
      throw err;
    }
    return originalRun.apply(this, [sql, ...rest] as never);
  };
  return () => {
    proto.run = originalRun;
  };
}

test("Resolve SQLITE_FULL recovery source must not delete backup-dir files", () => {
  const source = readFileSync(RESOLVE_SOURCE, "utf8");
  assert.equal(source.includes("reclaimDiskForResolveWrites"), false);
  assert.equal(/Drop every backup copy when the disk is full/.test(source), false);
  assert.equal(/unlinkSafe\(row\.full, "backup"\)/.test(source), false);
  assert.match(source, /SQLITE_FULL is fail-closed: never delete backups/);
});

test("SQLITE_FULL claim and heartbeat leave backup directory files untouched", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ifcdc-sqlite-full-"));
  process.env.IFCDC_DATA_DIR = dataDir;
  const backupDir = path.join(dataDir, "backups");
  mkdirSync(backupDir, { recursive: true });
  const sentinelName = "KEEP-2026-10-17-verified.db.enc";
  const sentinel = path.join(backupDir, sentinelName);
  writeFileSync(sentinel, "preserve-me");
  const before = listBackupNames(backupDir);

  const restore = forceSqliteFullOnNodeWrites();
  try {
    const { claimFirstAuraResolveNode, recordAuraResolveHeartbeat } = await import(
      "../server/hq/auraResolveProductionNode.ts"
    );

    const token = "n".repeat(32);
    const claim = await claimFirstAuraResolveNode({
      nodeId: "arn_sqlite_full_safety",
      token,
      label: "SQLITE_FULL safety",
    });
    assert.equal(claim.ok, false);
    assert.match(String(claim.error), /SQLITE_FULL|disk is full/i);
    assert.equal(existsSync(sentinel), true);
    assert.equal(readFileSync(sentinel, "utf8"), "preserve-me");
    assert.deepEqual(listBackupNames(backupDir), before);

    await assert.rejects(
      () => recordAuraResolveHeartbeat("arn_sqlite_full_safety", { ping: true }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /SQLITE_FULL|disk is full/i);
        return true;
      }
    );
    assert.equal(existsSync(sentinel), true);
    assert.equal(readFileSync(sentinel, "utf8"), "preserve-me");
    assert.deepEqual(listBackupNames(backupDir), before);
  } finally {
    restore();
  }
});
