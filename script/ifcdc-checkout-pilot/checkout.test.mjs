// This is a sandbox-only USD 10.00 checkout pilot. Mocked tests do not establish actual PayPal connectivity or production readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxClient } from './paypal.mjs';

const merchantId = 'MOCKMERCHANT';
const unit = () => ({ reference_id: 'pilot-product', amount: { currency_code: 'USD', value: '10.00' }, payee: { merchant_id: merchantId } });
const order = (status = 'APPROVED') => ({ id: 'ORDER123', intent: 'CAPTURE', status, purchase_units: [unit()] });
const completed = () => ({ ...order('COMPLETED'), purchase_units: [{ ...unit(), payments: { captures: [{ id: 'CAPTURE123', status: 'COMPLETED', final_capture: true, amount: { currency_code: 'USD', value: '10.00' } }] } }] });
const oauth = () => ({ access_token: 'TEST_TOKEN', token_type: 'Bearer' });
const config = { clientId: 'TEST_ID', clientSecret: 'TEST_SECRET', merchantId };

function setup(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.ok(url.startsWith('https://api-m.sandbox.paypal.com/'));
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    if (!responses.length) throw new Error('Unexpected request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { ok: true, ...response, json: async () => {
      if (response.badJson) throw new SyntaxError('Bad JSON');
      return response.data;
    } };
  };
  return { client: createSandboxClient({ ...config, fetchImpl }), calls };
}
const ok = data => ({ data });
const captureArgs = { orderId: 'ORDER123', requestId: 'capture-1' };

test('creates fixed-price order with real request contracts and mocked responses', async () => {
  const { client, calls } = setup([ok(oauth()), ok(order('CREATED'))]);
  assert.equal((await client.createOrder({ requestId: 'create-1' })).id, 'ORDER123');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
  assert.equal(calls[0].options.headers.Authorization, 'Basic ' + Buffer.from('TEST_ID:TEST_SECRET').toString('base64'));
  assert.equal(calls[0].options.body, 'grant_type=client_credentials');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const request = calls[1];
  assert.equal(request.url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders');
  assert.equal(request.options.headers.Authorization, 'Bearer TEST_TOKEN');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.headers['PayPal-Request-Id'], 'create-1');
  assert.equal(request.options.headers.Prefer, 'return=representation');
  assert.deepEqual(JSON.parse(request.options.body), { intent: 'CAPTURE', purchase_units: [unit()] });
});

test('checks order before capturing and verifies completed capture', async () => {
  const { client, calls } = setup([ok(oauth()), ok(order()), ok(completed())]);
  assert.equal((await client.captureOrder(captureArgs)).status, 'COMPLETED');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER123');
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[2].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER123/capture');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer TEST_TOKEN');
  assert.equal(calls[2].options.headers['PayPal-Request-Id'], 'capture-1');
  assert.equal(calls[2].options.headers.Prefer, 'return=representation');
});

test('accepts capture response without optional order amount/payee using verified pre-capture order', async () => {
  const response = completed();
  delete response.purchase_units[0].amount;
  delete response.purchase_units[0].payee;
  const { client } = setup([ok(oauth()), ok(order()), ok(response)]);
  assert.equal((await client.captureOrder(captureArgs)).status, 'COMPLETED');
});

test('reconciles already completed order without another capture', async () => {
  const { client, calls } = setup([ok(oauth()), ok(completed())]);
  await client.captureOrder(captureArgs);
  assert.equal(calls.length, 2);
});

for (const key of ['clientId', 'clientSecret', 'merchantId', 'fetchImpl']) {
  test(`rejects invalid configuration: ${key}`, () => {
    assert.throws(() => createSandboxClient({ ...config, fetchImpl: async () => {}, [key]: key === 'fetchImpl' ? 'bad' : ' ' }));
  });
}
for (const value of [undefined, '', ' ', 1, 'bad\r\nheader']) {
  test(`rejects request ID ${JSON.stringify(value)} before network access`, async () => {
    const { client, calls } = setup([]);
    await assert.rejects(client.createOrder({ requestId: value }), /Invalid request ID/);
    await assert.rejects(client.captureOrder({ ...captureArgs, requestId: value }), /Invalid request ID/);
    assert.equal(calls.length, 0);
  });
}
for (const value of [undefined, '', 'invalid_id!', '../other', 'A'.repeat(37), 123]) {
  test(`rejects order ID ${JSON.stringify(value)} before network access`, async () => {
    const { client, calls } = setup([]);
    await assert.rejects(client.captureOrder({ ...captureArgs, orderId: value }), /Invalid order ID/);
    assert.equal(calls.length, 0);
  });
}
for (const [name, response] of [
  ['OAuth HTTP failure', { ok: false }], ['OAuth network failure', new Error('TEST_SECRET')],
  ['OAuth redirect', { redirected: true }], ['OAuth malformed JSON', { badJson: true }],
  ['OAuth missing token', ok({})], ['OAuth nonstring token', ok({ access_token: 123, token_type: 'Bearer' })],
]) {
  test(name, async () => {
    const { client, calls } = setup([response]);
    await assert.rejects(client.createOrder({ requestId: 'create-1' }), error => !error.message.includes('TEST_SECRET'));
    assert.equal(calls.length, 1);
  });
}
for (const [name, change] of [
  ['wrong merchant', value => { value.purchase_units[0].payee.merchant_id = 'OTHER'; }],
  ['wrong amount', value => { value.purchase_units[0].amount.value = '9.00'; }],
  ['wrong currency', value => { value.purchase_units[0].amount.currency_code = 'EUR'; }],
  ['wrong order', value => { value.id = 'OTHER'; }],
  ['unapproved order', value => { value.status = 'CREATED'; }],
  ['missing purchase units', value => { delete value.purchase_units; }],
  ['wrong product', value => { value.purchase_units[0].reference_id = 'other'; }],
]) {
  test(`refuses capture before POST: ${name}`, async () => {
    const value = order(); change(value);
    const { client, calls } = setup([ok(oauth()), ok(value)]);
    await assert.rejects(client.captureOrder(captureArgs));
    assert.equal(calls.length, 2);
  });
}
for (const [name, change] of [
  ['wrong order ID', value => { value.id = 'OTHER'; }],
  ['incomplete order', value => { value.status = 'APPROVED'; }],
  ['incomplete capture', value => { value.purchase_units[0].payments.captures[0].status = 'PENDING'; }],
  ['wrong captured amount', value => { value.purchase_units[0].payments.captures[0].amount.value = '9.00'; }],
  ['wrong captured currency', value => { value.purchase_units[0].payments.captures[0].amount.currency_code = 'EUR'; }],
  ['wrong merchant', value => { value.purchase_units[0].payee.merchant_id = 'OTHER'; }],
  ['missing capture', value => { delete value.purchase_units[0].payments; }],
  ['multiple captures', value => { value.purchase_units[0].payments.captures.push(value.purchase_units[0].payments.captures[0]); }],
  ['missing capture ID', value => { delete value.purchase_units[0].payments.captures[0].id; }],
  ['nonfinal capture', value => { value.purchase_units[0].payments.captures[0].final_capture = false; }],
  ['wrong purchase unit', value => { value.purchase_units[0].reference_id = 'other'; }],
  ['null response', () => null],
]) {
  test(`rejects capture response: ${name}`, async () => {
    let value = completed(); const changed = change(value); if (changed === null) value = null;
    const { client } = setup([ok(oauth()), ok(order()), ok(value)]);
    await assert.rejects(client.captureOrder(captureArgs));
  });
}
test('rejects failed create HTTP response', async () => {
  const { client } = setup([ok(oauth()), { ok: false }]);
  await assert.rejects(client.createOrder({ requestId: 'create-1' }));
});
test('rejects failed capture HTTP response without retry', async () => {
  const { client, calls } = setup([ok(oauth()), ok(order()), { ok: false }]);
  await assert.rejects(client.captureOrder(captureArgs));
  assert.equal(calls.length, 3);
});
test('bounds even an injected fetch which ignores abort signals', { timeout: 6500 }, async () => {
  let receivedSignal;
  const client = createSandboxClient({ ...config, fetchImpl: (_url, options) => {
    receivedSignal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(client.createOrder({ requestId: 'create-timeout' }), /failed or timed out/);
  assert.equal(receivedSignal.aborted, true);
});
