// This is a sandbox-only USD 10.00 checkout pilot. Mocked tests do not establish actual PayPal connectivity or production readiness.
// Sandbox adapter for the Founder-only HQ pilot. Never connects to live PayPal.
const BASE = 'https://api-m.sandbox.paypal.com';
const ORDER_ID = /^[A-Z0-9]{1,36}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,108}$/;
const text = value => typeof value === 'string' && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
const money = value => value?.currency_code === 'USD' && value?.value === '10.00';
const fail = message => { throw new Error(message); };
const unitOf = order => {
  if (!Array.isArray(order?.purchase_units) || order.purchase_units.length !== 1) fail('Invalid purchase units');
  return order.purchase_units[0];
};

export function createSandboxClient({ clientId, clientSecret, merchantId, fetchImpl } = {}) {
  for (const [key, value] of Object.entries({ clientId, clientSecret, merchantId })) {
    if (!text(value)) fail(`${key} must be a non-empty string`);
  }
  if (typeof fetchImpl !== 'function') fail('fetchImpl must be a function');

  async function request(endpoint, options) {
    const signal = AbortSignal.timeout(5000);
    // Race also bounds injected implementations which fail to honor AbortSignal.
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(BASE + endpoint, { ...options, redirect: 'error', signal });
          if (!response?.ok || response.redirected) fail('PayPal request failed');
          const data = await response.json();
          if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Invalid PayPal response');
          return data;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PayPal request timed out')), 5000); }),
      ]);
    } catch {
      // Never expose provider bodies, credentials, injected exceptions or payer data.
      throw new Error('PayPal request failed or timed out');
    } finally { clearTimeout(timer); }
  }

  async function token() {
    const data = await request('/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!text(data.access_token) || /\s/.test(data.access_token) || data.token_type !== 'Bearer') fail('Invalid OAuth token');
    return data.access_token;
  }

  const headers = (accessToken, requestId) => ({ Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
    ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) });
  const checkRequestId = value => { if (typeof value !== 'string' || !REQUEST_ID.test(value)) fail('Invalid request ID'); };
  function checkOrder(order, orderId) {
    if (order?.id !== orderId || order.intent !== 'CAPTURE') fail('Order identity mismatch');
    const unit = unitOf(order);
    if (!money(unit?.amount)) fail('Order amount mismatch');
    if (unit?.payee?.merchant_id !== merchantId) fail('Order merchant mismatch');
    return unit;
  }
  function checkCapture(order, orderId, verifiedUnit) {
    if (order?.id !== orderId || order.status !== 'COMPLETED') fail('Capture order is not completed');
    const unit = unitOf(order);
    if (unit?.payee !== undefined && unit.payee?.merchant_id !== merchantId) fail('Capture merchant mismatch');
    if (unit?.amount !== undefined && !money(unit.amount)) fail('Capture order amount mismatch');
    if (unit?.reference_id !== verifiedUnit.reference_id) fail('Purchase unit identity mismatch');
    const captures = unit?.payments?.captures;
    if (!Array.isArray(captures) || captures.length !== 1) fail('Invalid capture count');
    const capture = captures[0];
    if (!text(capture?.id) || capture.status !== 'COMPLETED' || !money(capture.amount) || capture.final_capture !== true) {
      fail('Capture validation failed');
    }
    return order;
  }

  async function createOrder({ requestId, returnUrl, cancelUrl } = {}) {
    let paymentSource;
    if (returnUrl !== undefined || cancelUrl !== undefined) {
      for (const value of [returnUrl, cancelUrl]) {
        let url;
        try { url = new URL(value); } catch { fail('Invalid checkout return URL'); }
        if (typeof value !== 'string' || url.protocol !== 'https:' || url.username || url.password || url.hash) fail('Invalid checkout return URL');
      }
      if (new URL(returnUrl).origin !== new URL(cancelUrl).origin) fail('Checkout return origins must match');
      paymentSource = { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl,
        shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } };
    }
    checkRequestId(requestId);
    const accessToken = await token();
    const order = await request('/v2/checkout/orders', {
      method: 'POST', headers: headers(accessToken, requestId),
      body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: 'pilot-product',
        amount: { currency_code: 'USD', value: '10.00' }, payee: { merchant_id: merchantId } }],
        ...(paymentSource ? { payment_source: paymentSource } : {}) }),
    });
    if (typeof order.id !== 'string' || !ORDER_ID.test(order.id)) fail('Invalid created order ID');
    const unit = checkOrder(order, order.id);
    if (unit.reference_id !== 'pilot-product' || !['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(order.status)) fail('Invalid created order');
    return order;
  }

  async function captureOrder({ orderId, requestId } = {}) {
    if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) fail('Invalid order ID');
    checkRequestId(requestId);
    const accessToken = await token();
    // Verify the intended merchant and amount BEFORE a capture can move test funds.
    const order = await request(`/v2/checkout/orders/${orderId}`, { method: 'GET', headers: headers(accessToken) });
    const unit = checkOrder(order, orderId);
    if (unit.reference_id !== 'pilot-product') fail('Unknown product');
    if (order.status === 'COMPLETED') return checkCapture(order, orderId, unit);
    if (order.status !== 'APPROVED') fail('Buyer approval required');
    const captured = await request(`/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST', headers: headers(accessToken, requestId), body: '{}',
    });
    return checkCapture(captured, orderId, unit);
  }
  async function reconcileOrder({ orderId } = {}) {
    if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) fail('Invalid order ID');
    const accessToken = await token();
    const order = await request(`/v2/checkout/orders/${orderId}`, { method: 'GET', headers: headers(accessToken) });
    const unit = checkOrder(order, orderId);
    if (unit.reference_id !== 'pilot-product') fail('Unknown product');
    return checkCapture(order, orderId, unit);
  }
  return Object.freeze({ createOrder, captureOrder, reconcileOrder });
}
