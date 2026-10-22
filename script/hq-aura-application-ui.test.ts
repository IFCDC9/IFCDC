import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('UI requires separate test and publishing approvals; integrity-only passes never become PR options', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://hq.example.test' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const savedFetch = globalThis.fetch;
  const digest = 'a'.repeat(64);
  const requests: { url: string; body: any }[] = [];
  globalThis.fetch = (async (input: any, options: any) => {
    if (!options?.method) return Response.json({ runners: [{ id: 'mac', label: 'Founder Mac', revoked_at: null }],
      jobs: [{ id: 'stage', runner_id: 'mac', kind: 'stage_change_package_v1', status: 'succeeded', result: { packageSha256: digest } },
        { id: 'integrity', runner_id: 'mac', kind: 'test_change_package_v1', status: 'succeeded',
          result: { packageSha256: digest, testProfile: 'package-validator-v1', testsRun: true, exitCode: 0 } },
        { id: 'application', runner_id: 'mac', kind: 'test_change_package_v1', status: 'succeeded',
          result: { packageSha256: digest, testProfile: 'grant-subnav-v1', testsRun: true, exitCode: 0 } }], pullRequests: [] });
    requests.push({ url: String(input), body: JSON.parse(options.body) });
    return Response.json({ url: 'https://github.com/IFCDC9/IFCDC/pull/999' });
  }) as typeof fetch;
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { default: Panel } = await import('../client/src/components/hq/AuraRunnerPanel.tsx');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const root = createRoot(document.getElementById('root')!);
  const flush = () => new Promise(resolve => setTimeout(resolve, 15));
  const select = async (label: string, value: string) => React.act(async () => {
    const element = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush();
  });
  const check = async (text: string) => React.act(async () => {
    const label = [...document.querySelectorAll('label')].find(el => el.textContent?.includes(text))!;
    (label.querySelector('input') as HTMLInputElement).click(); await flush();
  });
  const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent === text)!;
  try {
    await React.act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Panel))); await flush(); });
    await React.act(async () => { await flush(); });
    await select('Staged package for tests', 'stage');
    await check('I approve running');
    assert.equal(button('Approve and queue package tests').disabled, false);
    await select('Package test profile', 'grant-subnav-v1');
    assert.equal(button('Approve and queue package tests').disabled, true, 'profile change clears approval');
    await check('I approve running');
    await React.act(async () => { button('Approve and queue package tests').click(); await flush(); });
    assert.deepEqual(requests[0].body, { stagingJobId: 'stage', reviewedSha256: digest, testProfile: 'grant-subnav-v1', approved: true });
    assert.equal(requests.length, 1, 'tests do not automatically publish');
    const choices = document.querySelector('select[aria-label="Passing application test for PR"]') as HTMLSelectElement;
    assert.deepEqual([...choices.options].map(o => o.value), ['', 'application']);
    await select('Passing application test for PR', 'application');
    assert.equal(button('Approve and publish draft PR').disabled, true);
    await check('I approve publishing');
    await React.act(async () => { button('Approve and publish draft PR').click(); await flush(); });
    assert.ok(requests[1].url.endsWith('/runner-draft-pr'));
    assert.deepEqual(requests[1].body, { testJobId: 'application', reviewedSha256: digest, approved: true });
    assert.equal(button('Approve and publish draft PR').disabled, true, 'publishing consumes approval');
  } finally {
    await React.act(async () => root.unmount()); client.clear(); globalThis.fetch = savedFetch; dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
