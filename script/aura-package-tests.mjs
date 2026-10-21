/** Fixed unit-test profile in a locally configured Docker sandbox. Never run staged code on the host. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stageChangePackage } from './aura-change-package.mjs';

const exec = promisify(execFile);
export const PACKAGE_TEST_PROFILE = 'package-validator-v1';
const suite = fileURLToPath(new URL('./aura-package-validator-suite.mjs', import.meta.url));
const error = (code, testsRun = null) => Object.assign(new Error(code), { code, testsRun });

export function sandboxArguments(image, snapshot, name) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image || '')) throw error('test_sandbox_unavailable', false);
  // --mount uses comma delimiters; refuse ambiguous paths rather than reinterpret them.
  if (/[\r\n,]/.test(snapshot)) throw error('test_sandbox_unavailable', false);
  return ['run', '--pull=never', '--name', name, '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m', '--cpus=1',
    '--user=65534:65534', '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
    '--mount', `type=bind,source=${snapshot},target=/suite,readonly`, '--workdir=/suite',
    '--env=HOME=/tmp', '--entrypoint=node', image, '--test', 'script/aura-package-validator-suite.mjs'];
}

export async function runPackageTests({ repoRoot, changePackage, reviewedSha256, testProfile, testImage }) {
  if (testProfile !== PACKAGE_TEST_PROFILE) throw error('test_profile_refused', false);
  const sandboxName = 'aura-test-' + crypto.randomUUID();
  const dockerEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LANG: 'C.UTF-8' };
  const docker = (args, timeout = 10_000) => exec('docker', args, {
    env: dockerEnv, timeout, maxBuffer: 64 * 1024, killSignal: 'SIGKILL', windowsHide: true,
  });
  sandboxArguments(testImage, os.tmpdir(), sandboxName);
  // A cached immutable local image ID is mandatory; this code never pulls or builds images.
  try { await docker(['image', 'inspect', testImage]); }
  catch { throw error('test_sandbox_unavailable', false); }
  let staged;
  let snapshot;
  try {
    try { staged = await stageChangePackage({ repoRoot, changePackage, reviewedSha256 }); }
    catch { throw error('test_staging_failed', false); }
    snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-test-suite-'));
    fs.chmodSync(snapshot, 0o755);
    // Only this module and the fixed trusted harness enter the container. No .git,
    // node_modules, environment files, private configuration or production data.
    fs.mkdirSync(path.join(snapshot, 'shared'), { mode: 0o755 });
    fs.mkdirSync(path.join(snapshot, 'script'), { mode: 0o755 });
    const source = path.join(staged.workspace, 'shared/auraChangePackage.mjs');
    for (const target of [path.dirname(source), source]) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (target === source ? !stat.isFile() || stat.size > 250_000 : !stat.isDirectory())) {
        throw error('test_snapshot_refused', false);
      }
    }
    fs.copyFileSync(source, path.join(snapshot, 'shared/auraChangePackage.mjs'));
    fs.copyFileSync(suite, path.join(snapshot, 'script/aura-package-validator-suite.mjs'));
    for (const target of ['shared/auraChangePackage.mjs', 'script/aura-package-validator-suite.mjs']) {
      fs.chmodSync(path.join(snapshot, target), 0o644);
    }
    const args = sandboxArguments(testImage, snapshot, sandboxName);
    const start = Date.now();
    try {
      await docker(args, 60_000);
      return { outcome: 'passed', exitCode: 0, durationMs: Date.now() - start, testsRun: true };
    } catch (failure) {
      // Exit codes 125/126/127 mean the container/test command could not start.
      if (failure.killed || failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error('test_limit_exceeded');
      if (typeof failure.code !== 'number' || [125, 126, 127].includes(failure.code)) throw error('test_sandbox_unavailable');
      return { outcome: 'failed', exitCode: failure.code, durationMs: Date.now() - start, testsRun: true };
    } finally {
      // Killing a timed-out Docker client alone does not stop its container.
      try { await docker(['rm', '--force', sandboxName], 5_000); }
      catch { throw error('test_cleanup_failed'); }
    }
  } finally {
    if (snapshot) fs.rmSync(snapshot, { recursive: true, force: true });
    if (staged) fs.rmSync(path.dirname(staged.workspace), { recursive: true, force: true });
  }
}
