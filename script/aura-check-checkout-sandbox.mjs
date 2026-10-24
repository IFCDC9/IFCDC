/** Verify good/broken fixtures in REAL local Docker before enabling the checkout profile. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sandboxArguments } from './aura-package-tests.mjs';
import { CHECKOUT_PATH, CHECKOUT_PROFILE } from '../shared/auraTestProfiles.mjs';

export function checkCheckoutSandbox(image) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LANG: 'C.UTF-8' };
  const docker = (args, timeout = 10_000) => execFileSync('docker', args, {
    env, timeout, maxBuffer: 64 * 1024, encoding: 'utf8', killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-checkout-release-'));
  fs.chmodSync(folder, 0o755);
  try {
    sandboxArguments(image, folder, 'check', CHECKOUT_PROFILE);
    docker(['image', 'inspect', image]);
    fs.mkdirSync(path.join(folder, path.dirname(CHECKOUT_PATH)), { recursive: true, mode: 0o755 });
    const suite = path.join(folder, 'script/aura-checkout-suite.mjs');
    fs.copyFileSync(new URL('./aura-checkout-suite.mjs', import.meta.url), suite);
    fs.chmodSync(suite, 0o644);
    const reference = fs.readFileSync(fileURLToPath(new URL('../' + CHECKOUT_PATH, import.meta.url)), 'utf8');
    for (const [label, content, expected] of [
      ['reference adapter', reference, 'pass'],
      ['broken adapter', 'export function createSandboxClient() { return {}; }', 'fail'],
      ['premature exit', 'process.exit(0); export function createSandboxClient() {}', 'incomplete'],
    ]) {
      const name = 'aura-checkout-release-' + crypto.randomUUID();
      fs.writeFileSync(path.join(folder, CHECKOUT_PATH), content, { mode: 0o644 });
      let failure, output = '';
      try { output = docker(sandboxArguments(image, folder, name, CHECKOUT_PROFILE), 60_000); }
      catch (error) { failure = error; }
      finally { docker(['rm', '--force', name], 5_000); }
      const complete = ['tests 47', 'pass 47', 'fail 0', 'cancelled 0', 'skipped 0', 'todo 0']
        .every(summary => new RegExp('(?:^|\n)# ' + summary + '\r?\n').test(output));
      if (expected === 'pass' ? failure || !complete : expected === 'fail' ? failure?.status !== 1 : failure || complete) {
        throw new Error('Checkout Docker release check failed: ' + label);
      }
      console.log('Real Docker checkout release check passed: ' + label);
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { checkCheckoutSandbox(process.argv[2]); }
  catch { console.error('Checkout sandbox check failed. Verify the cached immutable Node image and local Docker connection.'); process.exitCode = 1; }
}
