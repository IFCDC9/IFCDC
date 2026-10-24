/** Local setup: preserves enrollment, tests REAL Docker, then atomically opts in. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkCheckoutSandbox } from './aura-check-checkout-sandbox.mjs';
import { validateRunnerConfig } from './aura-mac-runner.mjs';
const configPath = process.env.AURA_RUNNER_CONFIG || path.join(os.homedir(), '.config/ifcdc/aura-runner.json');
let temporary;
try {
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.mode & 0o077)) throw new Error('private_config_required');
  const original = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(original);
  const image = process.argv[2] || config.checkoutTestImage || config.packageTestImage;
  const updated = { ...config, allowCheckoutTests: true, checkoutTestImage: image };
  validateRunnerConfig(updated);
  checkCheckoutSandbox(image);
  // Never overwrite a credential/config change made while the release check was running.
  if (fs.readFileSync(configPath, 'utf8') !== original) throw new Error('config_changed');
  temporary = configPath + '.checkout-' + crypto.randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, configPath);
  console.log('Checkout tests enabled after real Docker release checks. Restart the runner watch process to load this configuration.');
} catch {
  console.error('Checkout tests were not enabled. Check private config permissions, cached immutable Node image and local Docker. Configuration contents were not printed.');
  process.exitCode = 1;
} finally { if (temporary) fs.rmSync(temporary, { force: true }); }
