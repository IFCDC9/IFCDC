import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxArguments, runPackageTests } from './aura-package-tests.mjs';

const image = 'sha256:' + 'a'.repeat(64);
test('sandbox fixes entrypoint, network, privileges, mounts, resource limits and prohibits pulls', () => {
  const args = sandboxArguments(image, '/tmp/suite', 'aura-test-fixed');
  for (const value of ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m', '--cpus=1',
    '--user=65534:65534', '--entrypoint=node', 'type=bind,source=/tmp/suite,target=/suite,readonly']) assert.ok(args.includes(value));
  assert.deepEqual(args.slice(-3), [image, '--test', 'script/aura-package-validator-suite.mjs']);
});
test('mutable image names, ambiguous mounts, arbitrary profiles and missing images are refused', async () => {
  assert.throws(() => sandboxArguments('node:24', '/tmp/suite', 'name'));
  assert.throws(() => sandboxArguments(image, '/tmp/a,b', 'name'));
  await assert.rejects(runPackageTests({ testProfile: 'run_shell' }), /test_profile_refused/);
  await assert.rejects(runPackageTests({ testProfile: 'package-validator-v1' }), /test_sandbox_unavailable/);
});
