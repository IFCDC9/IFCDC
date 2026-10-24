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

test('application profile has its own trusted harness and refuses unrelated or new files', async () => {
  const args = sandboxArguments(image, '/tmp/suite', 'aura-test-fixed', 'grant-subnav-v1');
  assert.equal(args.at(-1), 'script/aura-grant-subnav-suite.mjs');
  assert.ok(args.includes('--test-reporter=tap'));
  for (const files of [[], [{ path: 'client/src/other.tsx', beforeSha256: 'a'.repeat(64) }],
    [{ path: 'client/src/components/hq/grants/GrantSubNav.tsx', beforeSha256: null }]]) {
    await assert.rejects(runPackageTests({ testProfile: 'grant-subnav-v1', changePackage: { files } }), /test_scope_refused/);
  }
});

test('checkout scope accepts only the two fixed paths and has a trusted offline harness', async () => {
  const { checkoutTestScope, CHECKOUT_PATH, CHECKOUT_TEST_PATH } = await import('../shared/auraTestProfiles.mjs');
  assert.equal(checkoutTestScope({ files: [{path: CHECKOUT_PATH}, {path: CHECKOUT_TEST_PATH}] }), true);
  for (const files of [[], [{path: CHECKOUT_PATH}], [{path: CHECKOUT_PATH}, {path: CHECKOUT_PATH}],
    [{path: CHECKOUT_PATH}, {path: 'script/other.mjs'}]]) {
    assert.equal(checkoutTestScope({files}), false);
    await assert.rejects(runPackageTests({ testProfile: 'checkout-sandbox-v1', changePackage: {files} }), /test_scope_refused/);
  }
  const args = sandboxArguments(image, '/tmp/suite', 'fixed', 'checkout-sandbox-v1');
  assert.equal(args.at(-1), 'script/aura-checkout-suite.mjs');
  assert.ok(args.includes('--network=none'));
});
