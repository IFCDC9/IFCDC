/**
 * AURA Software Engineering — SQLite schema for index, diagnoses, change packages, approvals, audits.
 */
import { getDb } from "../db";

let ready = false;

export async function ensureAuraSoftwareEngineeringTables(): Promise<void> {
  if (ready) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_se_repos (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      label TEXT NOT NULL,
      path_prefixes_json TEXT,
      last_indexed_at TEXT,
      index_source TEXT,
      file_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aura_se_index_files (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      symbols_json TEXT,
      deps_json TEXT,
      env_names_json TEXT,
      scripts_json TEXT,
      size_bytes INTEGER,
      sha TEXT,
      indexed_at TEXT NOT NULL,
      UNIQUE(repo_id, branch, path)
    );
    CREATE INDEX IF NOT EXISTS idx_aura_se_index_path ON aura_se_index_files(path);
    CREATE INDEX IF NOT EXISTS idx_aura_se_index_kind ON aura_se_index_files(kind);
    CREATE INDEX IF NOT EXISTS idx_aura_se_index_repo ON aura_se_index_files(repo_id);

    CREATE TABLE IF NOT EXISTS aura_se_diagnoses (
      id TEXT PRIMARY KEY,
      repo_id TEXT,
      title TEXT NOT NULL,
      symptom TEXT,
      root_cause TEXT,
      affected_files_json TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      recommended_fix TEXT,
      risk TEXT,
      required_tests_json TEXT,
      founder_approval_required INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      command TEXT,
      metadata_json TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_se_diag_status ON aura_se_diagnoses(status);

    CREATE TABLE IF NOT EXISTS aura_se_change_packages (
      id TEXT PRIMARY KEY,
      diagnosis_id TEXT,
      repo_id TEXT NOT NULL,
      branch_name TEXT,
      base_branch TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      proposed_ops_json TEXT,
      test_plan_json TEXT,
      diff_summary TEXT,
      risk_summary TEXT,
      test_run_id TEXT,
      commit_sha TEXT,
      pr_url TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_se_pkg_status ON aura_se_change_packages(status);

    CREATE TABLE IF NOT EXISTS aura_se_approvals (
      id TEXT PRIMARY KEY,
      change_package_id TEXT,
      repository TEXT NOT NULL,
      branch TEXT NOT NULL,
      commit_sha TEXT,
      service TEXT NOT NULL,
      action TEXT NOT NULL,
      risk_summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      approved_at TEXT,
      note TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_se_approval_status ON aura_se_approvals(status);

    CREATE TABLE IF NOT EXISTS aura_se_test_runs (
      id TEXT PRIMARY KEY,
      change_package_id TEXT,
      workspace_root TEXT,
      commands_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      overall_status TEXT NOT NULL,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aura_se_audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      detail TEXT,
      risk_level TEXT,
      founder_mode INTEGER DEFAULT 0,
      founder_approved INTEGER DEFAULT 0,
      metadata_json TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_se_audit_created ON aura_se_audit_log(created_at DESC);
  `);
  ready = true;
}
