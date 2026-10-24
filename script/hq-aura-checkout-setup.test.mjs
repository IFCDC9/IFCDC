import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Setup protocol only; no claim of real Docker isolation in this stand-in test.
test('checkout setup preserves private enrollment and opts in only after release fixtures pass', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-setup-test-'));
  const configPath = path.join(folder, 'runner.json');
  const docker = path.join(folder, 'docker');
  fs.writeFileSync(docker, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (fs.existsSync(require('node:path').join(__dirname, 'fail'))) process.exit(125);
if (args[0] === 'image' || args[0] === 'rm') process.exit(0);
const root = args[args.indexOf('--mount') + 1].split(',').find(v => v.startsWith('source=')).slice(7);
const adapter = fs.readFileSync(root + '/script/ifcdc-checkout-pilot/paypal.mjs', 'utf8');
if (adapter.includes('process.exit(0)')) process.exit(0);
if (adapter.includes('return {};')) process.exit(1);
console.log('# tests 47\\n# pass 47\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');
`, {mode: 0o755});
  const original = { hqUrl: 'https://hq.example.test', repoRoot: folder,
    runnerToken: 'aura_runner_' + 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) + '.' + 'x'.repeat(43),
    allowPackageStaging: true, allowPackageTests: true, packageTestImage: 'sha256:' + 'a'.repeat(64) };
  const run = (fail = false) => {
    if (fail) fs.writeFileSync(path.join(folder, 'fail'), ''); else fs.rmSync(path.join(folder, 'fail'), {force: true});
    return spawnSync(process.execPath, ['script/aura-enable-checkout-tests.mjs'], {
    encoding: 'utf8', env: { PATH: folder + path.delimiter + process.env.PATH, AURA_RUNNER_CONFIG: configPath,
      },
  }); };
  try {
    fs.writeFileSync(configPath, JSON.stringify(original), {mode: 0o600});
    const failed = run(true);
    assert.equal(failed.status, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath)), original);
    assert.ok(!failed.stderr.includes(original.runnerToken));
    const passed = run();
    assert.equal(passed.status, 0, passed.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath)), { ...original, allowCheckoutTests: true, checkoutTestImage: original.packageTestImage });
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.ok(!passed.stdout.includes(original.runnerToken));
    fs.chmodSync(configPath, 0o644);
    assert.equal(run().status, 1);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});
