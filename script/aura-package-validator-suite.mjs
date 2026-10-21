// Fixed, dependency-free profile. It tests only the package validator contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChangePackage, reviewChangePackage } from '../shared/auraChangePackage.mjs';

const sample = () => ({ version: 1, repository: 'IFCDC9/IFCDC', baseCommit: 'a'.repeat(40),
  summary: 'Contract test', files: [{ path: 'Documents/products/example.md', beforeSha256: null, content: 'Reviewed text\n' }] });

test('accepts a portable documentation package', () => {
  assert.deepEqual(validateChangePackage(sample()), sample());
});
test('digest binds the exact proposed content', () => {
  const value = sample();
  const first = reviewChangePackage(value);
  value.files[0].content += 'Changed\n';
  assert.notEqual(first.packageSha256, reviewChangePackage(value).packageSha256);
  assert.equal(first.testsRun, false);
});
test('rejects traversal, credentials and command fields', () => {
  for (const target of ['Documents/../escape.md', 'server/credentials.js', 'Documents/.env']) {
    const value = sample(); value.files[0].path = target;
    assert.throws(() => validateChangePackage(value));
  }
  assert.throws(() => validateChangePackage({ ...sample(), command: 'anything' }));
});
test('rejects case collisions and excessive content', () => {
  const value = sample();
  value.files.push({ ...value.files[0], path: 'Documents/products/EXAMPLE.md' });
  assert.throws(() => validateChangePackage(value));
  const large = sample(); large.files[0].content = 'x'.repeat(250_001);
  assert.throws(() => validateChangePackage(large));
});
