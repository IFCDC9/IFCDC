const base = '/api/public/support';
const byId = id => document.getElementById(id);
const key = kind => `ifcdc-public-${kind}-v1`;
let catalog;
let buttons;
let sdk;
const message = (kind, text, error = false) => { const element = byId(`${kind}-message`); element.textContent = text; element.classList.toggle('error', error); };
function pending(kind) {
  try { const value = JSON.parse(sessionStorage.getItem(key(kind)) || 'null'); return value && /^[a-f0-9-]{36}$/.test(value.id) && /^[a-f0-9]{64}$/.test(value.proof) && value.kind === kind ? value : null; } catch { return null; }
}
function persist(value) { sessionStorage.setItem(key(value.kind), JSON.stringify(value)); }
function amount(kind) {
  const value = byId(`${kind}-amount`).value;
  if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value) || Number(value) < 1 || Number(value) > (kind === 'membership' ? 1000 : 10000)) throw new Error('Enter an amount within the displayed limits, using at most two decimal places.');
  return Number(value).toFixed(2);
}
function attempt(kind) {
  const existing = pending(kind);
  if (existing) {
    if (existing.amount !== amount(kind)) throw new Error('An existing payment has a different amount. Recheck or finish it before starting another.');
    return existing;
  }
  const proof = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const value = { id: crypto.randomUUID(), proof, kind, amount: amount(kind), approved: true, ...(kind === 'membership' ? { recurringApproved: true } : {}) };
  persist(value); return value;
}
async function api(path, body, value) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(value ? { 'X-IFCDC-Receipt': value.proof } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request could not be confirmed. Recheck before starting another payment.');
  return data;
}
function action(label, fn) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button gold'; button.textContent = label;
  button.addEventListener('click', async () => { button.disabled = true; try { await fn(); } finally { button.disabled = false; } });
  return button;
}
function showReceipt(kind, row) {
  const element = byId(`${kind}-record`); element.replaceChildren(); element.hidden = false;
  const heading = document.createElement('h3');
  heading.textContent = kind === 'membership' ? (row.status === 'active' ? 'Membership active' : `Membership: ${row.status.replaceAll('_', ' ')}`) : (row.status === 'completed' ? 'Verified donation received' : `Donation: ${row.status.replaceAll('_', ' ')}`);
  element.append(heading);
  const dl = document.createElement('dl');
  const paid = row.payments?.filter(payment => payment.status === 'COMPLETED') || [];
  const details = [['Amount', `$${row.amount} USD${kind === 'membership' ? ' every month until canceled' : ' one time'}`], ['IFCDC receipt', row.id], ['PayPal reference', row.providerId || 'Not yet confirmed']];
  for (const payment of row.payments || []) details.push([`Transaction · ${payment.status}`, `${payment.id} · $${(payment.cents / 100).toFixed(2)} USD · ${new Date(payment.paidAt).toLocaleString()}`]);
  for (const [name, value] of details) { const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = name; dd.textContent = value; dl.append(dt, dd); }
  element.append(dl);
  if (kind === 'membership' && row.status === 'active' && !paid.length) { const note = document.createElement('p'); note.textContent = 'PayPal verified your membership activation. A completed recurring payment has not yet been recorded; payment updates can arrive separately.'; element.append(note); }
  element.append(action('Recheck existing payment', async () => { try { showReceipt(kind, await api(`/payments/${row.id}/recheck`, {}, pending(kind))); message(kind, 'Record checked with PayPal.'); } catch (error) { message(kind, error.message, true); } }));
  element.append(action('Print / save receipt', () => window.print()));
  if (kind === 'membership' && ['active', 'suspended', 'approved'].includes(row.status)) element.append(action('Cancel future renewals', async () => {
    if (!window.confirm('Cancel this membership and stop future monthly renewals? Past payments will not automatically be refunded.')) return;
    try { const result = await api(`/payments/${row.id}/cancel`, { approved: true }, pending(kind)); showReceipt(kind, result); message(kind, `PayPal membership status: ${result.status}.`); } catch (error) { message(kind, error.message, true); }
  }));
  const completed = kind === 'donation' ? ['completed', 'refunded', 'partially_refunded'].includes(row.status) : ['cancelled', 'expired'].includes(row.status);
  byId(`${kind}-form`).hidden = completed || (kind === 'membership' && ['active', 'suspended'].includes(row.status));
  byId(`${kind}-start`).disabled = !catalog?.ready || (kind === 'membership' && !completed && row.status === 'active');
  if (completed) element.append(action(kind === 'donation' ? 'Start another donation' : 'Start a new membership', () => {
    if (!window.confirm('Start a separate payment? Keep your existing PayPal receipt for your records.')) return;
    sessionStorage.removeItem(key(kind)); element.hidden = true; byId(`${kind}-form`).hidden = false; byId(`${kind}-consent`).checked = false; byId(`${kind}-start`).disabled = !catalog?.ready;
    if (kind === 'donation') { buttons?.close(); byId('paypal-buttons').replaceChildren(); }
    message(kind, 'Choose an amount and approve it to start a separate payment.');
  }));
}
function loadSdk() {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL('https://www.paypal.com/sdk/js');
    url.search = new URLSearchParams({ 'client-id': catalog.clientId, currency: 'USD', intent: 'capture', components: 'buttons', 'enable-funding': 'venmo,card,paylater' }).toString();
    script.src = url.href; script.dataset.namespace = 'ifcdcSupportPayPal'; script.onload = () => resolve(window.ifcdcSupportPayPal); script.onerror = () => { sdk = null; script.remove(); reject(new Error('PayPal payment methods could not load. Try again.')); }; document.head.append(script);
  }); return sdk;
}
for (const group of document.querySelectorAll('.amounts')) {
  const field = byId(group.dataset.target);
  group.addEventListener('click', event => { const button = event.target.closest('button[data-amount]'); if (!button) return; field.value = button.dataset.amount; field.dispatchEvent(new Event('input')); });
  field.addEventListener('input', () => {
    for (const button of group.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.amount === field.value));
    if (field.id === 'membership-amount') byId('renewal-summary').textContent = `$${Number(field.value || 0).toFixed(2)} USD every month until canceled.`;
    byId(field.id.replace('-amount', '-consent')).checked = false;
    if (field.id === 'donation-amount') { buttons?.close(); byId('paypal-buttons').replaceChildren(); }
  });
}
byId('donation-consent').addEventListener('change', () => { if (!byId('donation-consent').checked) { buttons?.close(); byId('paypal-buttons').replaceChildren(); } });
byId('donation-form').addEventListener('submit', async event => {
  event.preventDefault(); const start = byId('donation-start'); start.disabled = true;
  try {
    const value = attempt('donation'); const paypal = await loadSdk();
    buttons?.close(); byId('paypal-buttons').replaceChildren();
    buttons = paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
      createOrder: async () => {
        if (!byId('donation-consent').checked || amount('donation') !== value.amount) throw new Error('Approve the displayed donation amount first.');
        const row = await api('/payments', value); showReceipt('donation', row); return row.providerId;
      },
      onApprove: async data => {
        try {
          if (!byId('donation-consent').checked || amount('donation') !== value.amount) throw new Error('Donation consent changed. Recheck this existing order before continuing.');
          const row = await api(`/payments/${value.id}/capture`, { approved: true, orderId: data.orderID }, value);
          showReceipt('donation', row); message('donation', 'Thank you. Your donation is verified and your receipt is saved.'); byId('donation-consent').checked = false; buttons?.close();
        } catch (error) { message('donation', error.message, true); }
      },
      onCancel: () => message('donation', 'Checkout canceled. No payment is confirmed here. You can recheck the existing record.'),
      onError: () => message('donation', 'PayPal could not complete this checkout. Recheck the existing record before starting another.', true),
    });
    await buttons.render('#paypal-buttons'); message('donation', `Choose an available method to authorize your one-time $${value.amount} USD donation.`);
  } catch (error) { message('donation', error.message, true); } finally { start.disabled = !catalog?.ready; }
});
byId('membership-form').addEventListener('submit', async event => {
  event.preventDefault(); const start = byId('membership-start'); start.disabled = true;
  try {
    const value = attempt('membership'); const row = await api('/payments', value); showReceipt('membership', row);
    if (!row.approvalUrl || ['active', 'cancelled', 'expired'].includes(row.status)) { message('membership', 'Use the existing membership record below.'); return; }
    const url = new URL(row.approvalUrl);
    if (url.origin !== 'https://www.paypal.com' || url.pathname !== '/webapps/billing/subscriptions' || !/^BA-[A-Z0-9]+$/.test(url.searchParams.get('ba_token') || '')) throw new Error('Unexpected PayPal approval address.');
    window.location.assign(url.href);
  } catch (error) { message('membership', error.message, true); } finally { start.disabled = !catalog?.ready; }
});
byId('quote-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const button = form.querySelector('button[type=submit]'); const output = byId('quote-result'); button.disabled = true;
  try { const fields = new FormData(form); const input = Object.fromEntries(fields.entries()); input.consent = fields.get('consent') === 'on'; const result = await api('/inquiries', input); output.textContent = `${result.message}\nRequest ID: ${result.id}`; form.reset(); }
  catch (error) { output.textContent = error.message; } finally { button.disabled = false; }
});
try {
  catalog = await api('/catalog');
  byId('setup-notice').hidden = catalog.ready;
  for (const kind of ['donation', 'membership']) byId(`${kind}-start`).disabled = !catalog.ready;
  if (catalog.bookUrl) { const url = new URL(catalog.bookUrl); if (url.protocol === 'https:' && ['amazon.com', 'www.amazon.com', 'a.co'].includes(url.hostname)) { byId('book-link').href = url.href; byId('book-link').hidden = false; byId('book-unavailable').hidden = true; } }
  const callback = new URL(window.location.href);
  if (callback.searchParams.has('membership')) {
    const value = pending('membership');
    message('membership', value?.id === callback.searchParams.get('membership') ? (callback.searchParams.get('result') === 'cancelled' ? 'You canceled the PayPal approval. Rechecking does not initiate another payment.' : 'Returned from PayPal. Checking your membership; a return alone is not proof of payment.') : 'This return does not match a membership in this browser session. Check PayPal or contact IFCDC.');
    history.replaceState({}, '', '/support#membership');
  }
  for (const kind of ['donation', 'membership']) {
    const value = pending(kind); if (!value) continue;
    byId(`${kind}-amount`).value = value.amount; byId(`${kind}-amount`).dispatchEvent(new Event('input'));
    try { showReceipt(kind, await api(`/payments/${value.id}/recheck`, {}, value)); }
    catch (error) { message(kind, `${error.message} Your original attempt is retained for retry.`, true); }
  }
} catch { byId('setup-notice').hidden = false; byId('setup-notice').textContent = 'Payment status is temporarily unavailable. Please try again later or contact service@ifcdc.org.'; }
