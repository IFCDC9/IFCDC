import test from 'node:test';
import assert from 'node:assert/strict';
import { SOFTWARE_DIVISION_APPS, pollAppHealth } from '../server/hq/appRegistry';
const app = SOFTWARE_DIVISION_APPS.find(item => item.id === 'imperial')!;
test('public website opens official domain and does not inherit stale HQ metadata', () => {
  assert.equal(app.launchUrl, 'https://ifcdc.org/');
  assert.equal(app.healthUrl, app.launchUrl);
  assert.equal(app.status, 'production');
  assert.equal(app.version, undefined);
});
test('public website checks actual homepage and feed, rejects false positives and outages', async () => {
  const originalFetch = globalThis.fetch;
  const originalDeployment = process.env.HQ_IMPERIAL_DEPLOYMENT;
  process.env.HQ_IMPERIAL_DEPLOYMENT = 'development';
  try {
    for (const scenario of ['healthy','suspended','wrong-page','broken-feed','outage']) {
      const calls: string[] = [];
      globalThis.fetch = (async (url: any) => {
        calls.push(String(url));
        if (scenario === 'outage') throw new Error('unreachable');
        if (String(url).endsWith('/content')) return new Response(scenario === 'broken-feed' ? '{}' : '{"items":[]}', {headers:{'content-type':'application/json'}});
        return new Response(scenario === 'suspended' ? 'This service has been suspended by its owner.' : scenario === 'wrong-page' ? '<html>HQ login</html>' : '<link href="https://ifcdc.org/"><script src="/website.js">', {headers:{'content-type':'text/html'}});
      }) as typeof fetch;
      const result = await pollAppHealth(app);
      assert.equal(result.healthy, scenario === 'healthy', scenario);
      assert.equal(result.deployment,'production');
      assert.equal(result.version,undefined);
      assert.ok(calls.every(url => url.startsWith('https://ifcdc.org/')));
      assert.ok(result.data?.checkedAt);
      if (scenario === 'healthy') assert.equal(result.data?.publishedItems,0);
      else assert.ok(result.error);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeployment === undefined) delete process.env.HQ_IMPERIAL_DEPLOYMENT;
    else process.env.HQ_IMPERIAL_DEPLOYMENT = originalDeployment;
  }
});
