/** Trusted harness: executes only inside the opted-in application test container. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/opt/aura/package.json');
const { JSDOM } = require('jsdom');
const React = require('react');
const { buildSync } = require('esbuild');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Node']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const built = buildSync({ entryPoints: ['/suite/client/src/components/hq/grants/GrantSubNav.tsx'],
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'transform',
  // The trusted harness and component share one React dispatcher.
  external: ['react'], nodePaths: ['/opt/aura/node_modules'] });
fs.writeFileSync('/tmp/aura-component.mjs', built.outputFiles[0].text.replace(/from "react"/g,
  'from "/opt/aura/node_modules/react/index.js"'));
const { GrantSubNav } = await import('file:///tmp/aura-component.mjs');
const items = [{ id: 'dashboard', label: 'Executive Dashboard' }, { id: 'discover', label: 'Opportunity Finder' }];
async function fixture(run) {
  const host = document.getElementById('root');
  const root = createRoot(host);
  const calls = [];
  const render = async (active) => React.act(async () => root.render(React.createElement(GrantSubNav,
    { items, active, onChange: (id) => calls.push(id) })));
  try { await render('dashboard'); await run({ host, calls, render }); }
  finally { await React.act(async () => root.unmount()); }
}
test('navigation exposes its accessible name and supplied labels', async () => fixture(async ({ host }) => {
  assert.equal(host.querySelector('nav')?.getAttribute('aria-label'), 'Section navigation');
  assert.deepEqual([...host.querySelectorAll('button')].map(b => b.textContent), items.map(i => i.label));
}));
test('Opportunity Finder click reports its exact tab ID once', async () => fixture(async ({ host, calls }) => {
  await React.act(async () => host.querySelectorAll('button')[1].click());
  assert.deepEqual(calls, ['discover']);
}));
test('active styling follows a parent tab change and can return to dashboard', async () => fixture(async ({ host, calls, render }) => {
  await render('discover');
  assert.equal(host.querySelectorAll('button')[1].classList.contains('hq-btn-primary'), true);
  assert.equal(host.querySelectorAll('button')[0].classList.contains('hq-btn-primary'), false);
  await React.act(async () => host.querySelectorAll('button')[0].click());
  assert.deepEqual(calls, ['dashboard']);
  await render('dashboard');
  assert.equal(host.querySelectorAll('button')[0].classList.contains('hq-btn-primary'), true);
}));
test('navigation buttons do not submit a containing form', async () => fixture(async ({ host }) => {
  assert.ok([...host.querySelectorAll('button')].every(b => b.type === 'button'));
  const form = document.createElement('form');
  let submissions = 0;
  form.onsubmit = (event) => { event.preventDefault(); submissions++; };
  host.parentNode.insertBefore(form, host); form.append(host);
  try { await React.act(async () => host.querySelectorAll('button')[1].click()); assert.equal(submissions, 0); }
  finally { form.parentNode.insertBefore(host, form); form.remove(); }
}));
test.after(() => dom.window.close());
