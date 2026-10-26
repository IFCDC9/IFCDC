import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../public/support.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/support.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
async function setup(options = {}) {
  const dom = new JSDOM(html, { url: options.url || 'https://hq.example.test/support' });
  const { window } = dom; const requests = []; let sdkOptions;
  if (options.pending) window.sessionStorage.setItem(`ifcdc-public-${options.pending.kind}-v1`, JSON.stringify(options.pending));
  const config = { ready: options.ready !== false, clientId: 'PUBLIC_ID', bookUrl: options.bookUrl || null };
  const fetch = async (url, request) => {
    const body = request.body && JSON.parse(request.body); requests.push({ url, request, body });
    let data;
    if (url.endsWith('/catalog')) data = config;
    else if (url.endsWith('/inquiries')) data = { id: 'QUOTE1', message: '<img src=x onerror=alert(1)> Your request is saved.' };
    else if (url.endsWith('/payments')) data = { id: body.id, kind: body.kind, status: 'awaiting_approval', amount: body.amount, providerId: 'ORDER1', payments: [] };
    else if (url.endsWith('/capture')) data = { id: url.split('/')[5], kind: 'donation', status: 'completed', amount: '25.00', providerId: 'ORDER1', payments: [{ id: 'CAPTURE1', cents: 2500, status: 'COMPLETED', paidAt: new Date().toISOString() }] };
    else data = { id: options.pending?.id || 'existing', kind: options.pending?.kind || 'donation', status: options.status || 'active', amount: options.pending?.amount || '10.00', providerId: 'I-1', payments: [] };
    return { ok: true, json: async () => data };
  };
  const append = window.document.head.append.bind(window.document.head);
  window.document.head.append = element => {
    if (element.tagName === 'SCRIPT' && element.src.startsWith('https://www.paypal.com/sdk/js')) {
      window.ifcdcSupportPayPal = { Buttons: value => { sdkOptions = value; return { close() {}, async render() {} }; } };
      queueMicrotask(() => element.onload());
    } else append(element);
  };
  window.confirm = () => options.confirm !== false; window.print = () => {};
  await new AsyncFunction('window', 'document', 'sessionStorage', 'fetch', 'crypto', 'history', 'Event', 'FormData', 'AbortSignal', source)(window, window.document, window.sessionStorage, fetch, webcrypto, window.history, window.Event, window.FormData, AbortSignal);
  return { window, dom, requests, sdk: () => sdkOptions, $: id => window.document.getElementById(id) };
}
test('all approved categories and mission copy are present; recurring amounts and cancellation terms are explicit', async () => {
  const ui = await setup(); const text = ui.window.document.body.textContent;
  for (const phrase of ['software systems', 'monthly newsletter', '$20', '$40', '$60', 'renew automatically until I cancel', 'Custom software development', 'Bars & Clippers']) assert.ok(text.includes(phrase), phrase);
  assert.equal(ui.$('book-link').hidden, true); assert.equal(ui.$('setup-notice').hidden, true); ui.dom.window.close();
});
test('activation off disables financial controls while service request remains available', async () => {
  const ui = await setup({ ready: false }); assert.equal(ui.$('donation-start').disabled, true); assert.equal(ui.$('membership-start').disabled, true);
  assert.equal(ui.$('setup-notice').hidden, false); assert.equal(ui.$('quote-form').querySelector('button').disabled, false); ui.dom.window.close();
});
test('changing monthly amount updates renewal disclosure and clears prior approval', async () => {
  const ui = await setup(); ui.$('membership-consent').checked = true;
  ui.window.document.querySelector('[data-target="membership-amount"] [data-amount="40"]').click();
  assert.equal(ui.$('membership-amount').value, '40'); assert.equal(ui.$('membership-consent').checked, false); assert.match(ui.$('renewal-summary').textContent, /40\.00 USD every month/);
  ui.$('membership-amount').value = '23.45'; ui.$('membership-amount').dispatchEvent(new ui.window.Event('input'));
  assert.match(ui.$('renewal-summary').textContent, /23\.45/); ui.dom.window.close();
});
test('SDK create and capture bind original amount and session proof; success displays receipt and hides repeat checkout', async () => {
  const ui = await setup(); ui.$('donation-consent').checked = true;
  ui.$('donation-form').dispatchEvent(new ui.window.Event('submit', { cancelable: true })); await settle();
  assert.equal(ui.requests.filter(item => item.url.endsWith('/payments')).length, 0);
  assert.equal(await ui.sdk().createOrder(), 'ORDER1'); await ui.sdk().onApprove({ orderID: 'ORDER1' });
  const capture = ui.requests.find(item => item.url.endsWith('/capture')); assert.equal(capture.body.orderId, 'ORDER1'); assert.equal(capture.body.approved, true); assert.equal(capture.request.headers['X-IFCDC-Receipt'].length, 64);
  assert.match(ui.$('donation-record').textContent, /Verified donation received/); assert.match(ui.$('donation-record').textContent, /CAPTURE1/); assert.equal(ui.$('donation-form').hidden, true); ui.dom.window.close();
});
test('canceling PayPal never captures; revoked consent blocks a later approval callback', async () => {
  const ui = await setup(); ui.$('donation-consent').checked = true; ui.$('donation-form').dispatchEvent(new ui.window.Event('submit', { cancelable: true })); await settle();
  await ui.sdk().createOrder(); ui.sdk().onCancel(); assert.match(ui.$('donation-message').textContent, /canceled/);
  ui.$('donation-consent').checked = false; await ui.sdk().onApprove({ orderID: 'ORDER1' }); assert.equal(ui.requests.filter(item => item.url.endsWith('/capture')).length, 0); ui.dom.window.close();
});
test('membership callback only rechecks, never creates, captures or claims an unverified recurring payment', async () => {
  const pending = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', proof: 'a'.repeat(64), kind: 'membership', amount: '20.00', approved: true, recurringApproved: true };
  const ui = await setup({ pending, url: `https://hq.example.test/support?membership=${pending.id}&result=approved` });
  assert.equal(ui.requests.filter(item => item.request.method === 'POST').length, 1); assert.ok(ui.requests[1].url.endsWith('/recheck'));
  assert.match(ui.$('membership-record').textContent, /completed recurring payment has not yet been recorded/); assert.equal(ui.$('membership-form').hidden, true); assert.equal(ui.window.location.search, '');
  ui.dom.window.close();
});
test('quote submission sends approved details and renders server response as text, not HTML', async () => {
  const ui = await setup(); ui.$('quote-name').value = 'Customer'; ui.$('quote-email').value = 'customer@example.test'; ui.$('quote-message').value = 'A new community website'; ui.$('quote-form').querySelector('[name=consent]').checked = true;
  ui.$('quote-form').dispatchEvent(new ui.window.Event('submit', { cancelable: true })); await settle();
  const request = ui.requests.find(item => item.url.endsWith('/inquiries')); assert.equal(request.body.consent, true); assert.equal(request.body.service, 'Custom software development');
  assert.equal(ui.$('quote-result').querySelector('img'), null); assert.match(ui.$('quote-result').textContent, /QUOTE1/); ui.dom.window.close();
});
