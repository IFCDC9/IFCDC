/** Project payments use immutable accepted terms and an isolated ledger. */
import crypto from 'node:crypto';
import { ClientError, clientDb, clientLimit, readClientProject } from './clientPortal';
import { readEngagement } from './clientEngagement';
import { supportConfiguration, subscriptionApproval } from './publicSupport';
import { publicPayPal, ProviderError } from './publicSupportPayPal';
import { validateApprovalUrl } from './auraLiveCheckout';
import { websiteOrigins } from './publicWebsite';
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const uuid = /^[a-f0-9-]{36}$/;
const providerId = /^[A-Z0-9-]{1,64}$/;
const money = (n: number) => (n / 100).toFixed(2);
const PRODUCT = 'IFCDC-PROJECT-MAINTENANCE-V1';
export async function projectBillingDb() {
    const db = await clientDb();
    await db.exec(`
CREATE TABLE IF NOT EXISTS ifcdc_project_billing(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,cents INTEGER NOT NULL,terms_hash TEXT NOT NULL,terms_json TEXT NOT NULL,status TEXT NOT NULL,merchant TEXT NOT NULL,app_hash TEXT NOT NULL,provider_id TEXT UNIQUE,plan_id TEXT,approval_url TEXT,start_at TEXT,origin TEXT,created_at INTEGER NOT NULL,attempt_at INTEGER,verified_at INTEGER,lock_until INTEGER NOT NULL DEFAULT 0,UNIQUE(project_id,kind));
CREATE TABLE IF NOT EXISTS ifcdc_project_payments(provider_id TEXT PRIMARY KEY,billing_id TEXT NOT NULL,cents INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,paid_at TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ifcdc_project_billing_audit(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,actor_id TEXT NOT NULL,event TEXT NOT NULL,created_at INTEGER NOT NULL);
`);
    return db;
}
export function projectPaymentConfiguration(env: NodeJS.ProcessEnv = process.env) { const cfg = supportConfiguration(env); return { ...cfg, ready: cfg.ready && env.IFCDC_PROJECT_PAYMENTS_ENABLED === 'true' }; }
export function createProjectBillingService(options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    now?: () => number;
} = {}) {
    const env = options.env || process.env;
    const now = options.now || Date.now;
    function cfg(enabled = false) {
        const c = projectPaymentConfiguration(env);
        if (!c.configured || !c.webhookId || (enabled && !c.ready))
            throw new ClientError(503, 'Project checkout is not enabled. Your quote and saved design are retained.');
        return c;
    }
    const api = (enabled = false) => publicPayPal(cfg(enabled), options.fetchImpl);
    async function terms(id: string, clientId?: string) {
        const p = clientId ? await readClientProject(clientId, id) : await (await clientDb()).get('SELECT id FROM ifcdc_client_projects WHERE id=?', id);
        if (!p)
            throw new ClientError(404, 'Project not found.');
        const e = await readEngagement(id, clientId);
        if (e.quoteStatus !== 'ACCEPTED' || !e.quote)
            throw new ClientError(409, 'Accept the project quote before checkout.');
        return e;
    }
    async function rowFor(id: string, kind: string, clientId?: string) {
        if (!['build', 'maintenance'].includes(kind) || !uuid.test(id))
            throw new ClientError(400, 'Invalid project payment.');
        const e = await terms(id, clientId);
        const db = await projectBillingDb();
        const r = await db.get('SELECT * FROM ifcdc_project_billing WHERE project_id=? AND kind=?', id, kind);
        if (!r)
            throw new ClientError(409, 'IFCDC has not released this payment yet.');
        const c = cfg();
        if (r.merchant !== c.merchantId || r.app_hash !== hash(c.clientId) || r.terms_hash !== hash(JSON.stringify(e.quote)))
            throw new ClientError(409, 'Payment configuration or project terms changed. Contact IFCDC before paying.');
        return r;
    }
    async function lease(r: any, fn: (r: any) => Promise<any>) {
        const db = await projectBillingDb();
        const stamp = now() + 120000;
        if (!(await db.run('UPDATE ifcdc_project_billing SET lock_until=? WHERE id=? AND lock_until<=?', stamp, r.id, now())).changes)
            throw new ClientError(409, 'This payment is being checked. Wait and refresh before trying again.');
        try {
            return await fn(await db.get('SELECT * FROM ifcdc_project_billing WHERE id=?', r.id));
        }
        finally {
            await db.run('UPDATE ifcdc_project_billing SET lock_until=0 WHERE id=? AND lock_until=?', r.id, stamp);
        }
    }
    async function update(r: any, status: string) { await (await projectBillingDb()).run('UPDATE ifcdc_project_billing SET status=?,verified_at=? WHERE id=?', status, now(), r.id); }
    async function ledger(r: any, p: any) {
        const db = await projectBillingDb();
        const exists = await db.get('SELECT billing_id FROM ifcdc_project_payments WHERE provider_id=?', p.id);
        if (exists && exists.billing_id !== r.id)
            throw Error('Payment identity mismatch');
        await db.run(`INSERT INTO ifcdc_project_payments VALUES(?,?,?,'USD',?,?,?) ON CONFLICT(provider_id) DO UPDATE SET status=excluded.status,updated_at=CASE WHEN status!=excluded.status THEN excluded.updated_at ELSE updated_at END`, p.id, r.id, r.cents, p.status, p.time, now());
    }
    function checkOrder(r: any, order: any) {
        const u = order?.purchase_units?.[0];
        if (order?.id !== r.provider_id || order.intent !== 'CAPTURE' || order.purchase_units?.length !== 1 || u.reference_id !== 'ifcdc-project-build' || u.custom_id !== r.id || u.invoice_id !== 'IFCDC-' + r.id || u.payee?.merchant_id !== cfg().merchantId || u.amount?.currency_code !== 'USD' || u.amount.value !== money(r.cents))
            throw Error('Order identity or amount mismatch');
        return u;
    }
    async function syncBuild(r: any) {
        const order = await api()('/v2/checkout/orders/' + r.provider_id);
        const u = checkOrder(r, order);
        if (u.payments?.captures?.length) {
            if (u.payments.captures.length !== 1)
                throw Error('Unexpected captures');
            const id = u.payments.captures[0].id;
            if (!providerId.test(id))
                throw Error('Invalid capture');
            const cap = await api()('/v2/payments/captures/' + id);
            if (cap.id !== id || cap.amount?.currency_code !== 'USD' || cap.amount.value !== money(r.cents) || cap.final_capture !== true || !['COMPLETED', 'PENDING', 'DECLINED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED'].includes(cap.status) || !Number.isFinite(Date.parse(cap.create_time)))
                throw Error('Capture mismatch');
            if (cap.supplementary_data?.related_ids?.order_id && cap.supplementary_data.related_ids.order_id !== r.provider_id)
                throw Error('Wrong capture order');
            await ledger(r, { id, status: cap.status, time: cap.create_time });
            await update(r, cap.status);
        }
        else {
            if (!['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED', 'VOIDED'].includes(order.status))
                throw Error('Unconfirmed order');
            await update(r, order.status);
        }
        return order;
    }
    function checkPlan(r: any, p: any) {
        const c = p.billing_cycles?.[0];
        if (p.id !== r.plan_id || p.product_id !== PRODUCT || p.status !== 'ACTIVE' || p.quantity_supported === true || p.billing_cycles?.length !== 1 || c.tenure_type !== 'REGULAR' || c.sequence !== 1 || c.frequency?.interval_unit !== 'MONTH' || c.frequency.interval_count !== 1 || c.total_cycles !== 0 || c.pricing_scheme?.fixed_price?.currency_code !== 'USD' || c.pricing_scheme.fixed_price.value !== money(r.cents) || p.payment_preferences?.auto_bill_outstanding !== false || p.payment_preferences?.payment_failure_threshold !== 1 || p.payment_preferences?.setup_fee?.currency_code !== 'USD' || Number(p.payment_preferences.setup_fee.value) !== 0 || (p.taxes && Number(p.taxes.percentage) !== 0))
            throw Error('Maintenance plan terms mismatch');
    }
    async function syncMaintenance(r: any) {
        const s = await api()('/v1/billing/subscriptions/' + r.provider_id);
        if (s.id !== r.provider_id || s.plan_id !== r.plan_id || s.custom_id !== r.id || s.plan_overridden === true || (s.quantity !== undefined && s.quantity !== '1') || !['APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'].includes(s.status) || Date.parse(s.start_time) !== Date.parse(r.start_at) || (s.shipping_amount && Number(s.shipping_amount.value) !== 0))
            throw Error('Maintenance identity mismatch');
        if (!['CANCELLED', 'EXPIRED'].includes(s.status))
            checkPlan(r, await api()('/v1/billing/plans/' + r.plan_id));
        await update(r, s.status);
        return s;
    }
    async function sale(r: any, id: string) {
        if (!providerId.test(id))
            throw Error('Invalid sale');
        const s = await api()('/v1/payments/sale/' + id);
        if (s.id !== id || s.billing_agreement_id !== r.provider_id || s.amount?.currency !== 'USD' || s.amount.total !== money(r.cents) || !['completed', 'refunded', 'partially_refunded', 'reversed', 'denied', 'pending'].includes(s.state) || !Number.isFinite(Date.parse(s.create_time)))
            throw Error('Recurring payment mismatch');
        await ledger(r, { id: s.id, status: s.state.toUpperCase(), time: s.create_time });
    }
    async function view(id: string, clientId?: string) { const e = await readEngagement(id, clientId); const db = await projectBillingDb(); const rows = await db.all('SELECT * FROM ifcdc_project_billing WHERE project_id=? ORDER BY kind', id); const payments = await db.all('SELECT p.provider_id AS id,p.cents,p.currency,p.status,p.paid_at AS paidAt,b.kind FROM ifcdc_project_payments p JOIN ifcdc_project_billing b ON b.id=p.billing_id WHERE b.project_id=? ORDER BY p.paid_at DESC LIMIT 100', id); return { enabled: projectPaymentConfiguration(env).ready, quoteAccepted: e.quoteStatus === 'ACCEPTED', buildWaived: e.quoteStatus === 'ACCEPTED' && e.quote?.buildCents === 0, monthlyWaived: e.quoteStatus === 'ACCEPTED' && e.quote?.monthlyCents === 0, records: rows.map((r: any) => ({ id: r.id, kind: r.kind, cents: r.cents, status: r.status, providerId: r.provider_id, approvalUrl: r.approval_url, startAt: r.start_at, attemptAt: r.attempt_at, verifiedAt: r.verified_at })), payments }; }
    async function audit(id: string, actor: string, event: string) { await (await projectBillingDb()).run('INSERT INTO ifcdc_project_billing_audit VALUES(?,?,?,?,?)', crypto.randomUUID(), id, actor, event, now()); }
    return { view,
        async release(actor: string, id: string, input: any) {
            if (input?.consent !== true || !['build', 'maintenance'].includes(input.kind))
                throw new ClientError(400, 'Confirm release of the accepted project payment.');
            const e = await terms(id);
            const c = cfg(true);
            const db = await projectBillingDb();
            let start: string | null = null;
            const cents = input.kind === 'build' ? e.quote!.buildCents : e.quote!.monthlyCents;
            if (cents === 0)
                throw new ClientError(409, 'This fee is waived in the accepted quote.');
            if (input.kind === 'maintenance') {
                if (e.deliveryStatus !== 'ACCEPTED')
                    throw new ClientError(409, 'The client must approve delivery before maintenance billing is released.');
                const build = await db.get("SELECT status FROM ifcdc_project_billing WHERE project_id=? AND kind='build'", id);
                if (e.quote!.buildCents > 0 && build?.status !== 'COMPLETED')
                    throw new ClientError(409, 'Verify the build payment before releasing maintenance.');
                const date = typeof input.startAt === 'string' ? Date.parse(input.startAt) : NaN;
                if (!Number.isFinite(date) || date < now() + 3600000 || date > now() + 90 * 86400000)
                    throw new ClientError(400, 'Choose the first maintenance charge between one hour and 90 days from now, consistent with accepted terms.');
                start = new Date(date).toISOString();
            }
            await db.run(`INSERT OR IGNORE INTO ifcdc_project_billing(id,project_id,kind,cents,terms_hash,terms_json,status,merchant,app_hash,start_at,created_at) VALUES(?,?,?,?,?,?,'RELEASED',?,?,?,?)`, crypto.randomUUID(), id, input.kind, cents, hash(JSON.stringify(e.quote)), JSON.stringify(e.quote), c.merchantId, hash(c.clientId), start, now());
            if (input.kind === 'maintenance')
                await db.run("UPDATE ifcdc_project_billing SET start_at=? WHERE project_id=? AND kind='maintenance' AND attempt_at IS NULL AND lock_until<=?", start, id, now());
            await audit(id, actor, 'RELEASE_' + input.kind.toUpperCase());
            return view(id);
        },
        async create(clientId: string, id: string, input: any, origin: string) {
            if (input?.consent !== true || Object.keys(input).some(k => !['kind', 'consent', 'startAt'].includes(k)))
                throw new ClientError(400, 'Approve the displayed amount and recurring terms before continuing to PayPal.');
            await clientLimit(clientId, 'project-checkout', 20);
            cfg(true);
            const r = await rowFor(id, input.kind, clientId);
            if (r.kind === 'maintenance' && input.startAt !== r.start_at)
                throw new ClientError(409, 'The maintenance start date changed. Refresh and review it before authorizing.');
            return lease(r, async (r) => {
                if (r.kind === 'maintenance' && input.startAt !== r.start_at)
                    throw new ClientError(409, 'The maintenance start date changed. Refresh and review it before authorizing.');
                if (r.provider_id)
                    return view(id, clientId);
                const ttl = r.kind === 'build' ? 3 * 3600000 : 48 * 3600000;
                if (r.attempt_at && now() - r.attempt_at > ttl)
                    throw new ClientError(409, 'This checkout needs IFCDC reconciliation before another attempt. Do not start a second payment.');
                if (!websiteOrigins(env).includes(origin))
                    throw new ClientError(400, 'Use the IFCDC client workspace.');
                const db = await projectBillingDb();
                if (!r.attempt_at) {
                    await db.run('UPDATE ifcdc_project_billing SET attempt_at=?,origin=? WHERE id=?', now(), origin, r.id);
                    r.attempt_at = now();
                    r.origin = origin;
                }
                const callback = r.origin + '/client?billing=' + encodeURIComponent(id);
                const a = api(true);
                try {
                    if (r.kind === 'build') {
                        const o = await a('/v2/checkout/orders', 'POST', { intent: 'CAPTURE', purchase_units: [{ reference_id: 'ifcdc-project-build', custom_id: r.id, invoice_id: 'IFCDC-' + r.id, description: 'IFCDC accepted project build', amount: { currency_code: 'USD', value: money(r.cents) }, payee: { merchant_id: cfg().merchantId } }], application_context: { brand_name: 'IFCDC', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: callback, cancel_url: callback + '&cancelled=1' } }, 'pb-order-' + r.id);
                        if (!providerId.test(o.id))
                            throw Error('Missing order');
                        r.provider_id = o.id;
                        checkOrder(r, o);
                        const url = validateApprovalUrl(o.links?.find((l: any) => l.rel === 'approve')?.href, o.id);
                        await db.run("UPDATE ifcdc_project_billing SET provider_id=?,approval_url=?,status='CREATED' WHERE id=?", o.id, url, r.id);
                    }
                    else {
                        if (Date.parse(r.start_at) <= now() + 300000)
                            throw new ClientError(409, 'The maintenance start time needs IFCDC review before authorization.');
                        if (!r.plan_id) {
                            let product;
                            try {
                                product = await a('/v1/catalogs/products/' + PRODUCT);
                            }
                            catch (error) {
                                if (!(error instanceof ProviderError) || error.status !== 404)
                                    throw error;
                                product = await a('/v1/catalogs/products', 'POST', { id: PRODUCT, name: 'IFCDC Project Maintenance', type: 'SERVICE', category: 'SOFTWARE' }, 'pb-product-' + hash(cfg().clientId).slice(0, 30));
                            }
                            if (product.id !== PRODUCT || product.type !== 'SERVICE')
                                throw Error('Wrong product');
                            const p = await a('/v1/billing/plans', 'POST', { product_id: PRODUCT, name: 'IFCDC project ' + r.id, status: 'ACTIVE', quantity_supported: false, billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { currency_code: 'USD', value: money(r.cents) } } }], payment_preferences: { auto_bill_outstanding: false, setup_fee: { currency_code: 'USD', value: '0.00' }, setup_fee_failure_action: 'CANCEL', payment_failure_threshold: 1 } }, 'pb-plan-' + r.id);
                            if (!providerId.test(p.id))
                                throw Error('Invalid plan');
                            r.plan_id = p.id;
                            checkPlan(r, p);
                            await db.run('UPDATE ifcdc_project_billing SET plan_id=? WHERE id=?', p.id, r.id);
                        }
                        const s = await a('/v1/billing/subscriptions', 'POST', { plan_id: r.plan_id, custom_id: r.id, start_time: r.start_at, application_context: { brand_name: 'IFCDC', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW', return_url: callback, cancel_url: callback + '&cancelled=1' } }, 'pb-sub-' + r.id);
                        if (!providerId.test(s.id) || s.custom_id !== r.id || s.plan_id !== r.plan_id)
                            throw Error('Subscription mismatch');
                        const url = subscriptionApproval(s.links?.find((l: any) => l.rel === 'approve')?.href);
                        await db.run("UPDATE ifcdc_project_billing SET provider_id=?,approval_url=?,status='APPROVAL_PENDING' WHERE id=?", s.id, url, r.id);
                    }
                    await audit(id, clientId, 'CHECKOUT_' + r.kind.toUpperCase());
                    return view(id, clientId);
                }
                catch (error) {
                    if (error instanceof ClientError)
                        throw error;
                    throw new ClientError(502, 'PayPal has not confirmed this checkout. Refresh and retry this same project; do not create another payment.');
                }
            });
        },
        async recheck(clientId: string | undefined, id: string, kind: string, capture = false) {
            if (clientId)
                await clientLimit(clientId, 'project-payment-check', 60);
            const r = await rowFor(id, kind, clientId);
            if (!r.provider_id)
                return view(id, clientId);
            return lease(r, async (r) => {
                try {
                    if (r.kind === 'build') {
                        const order = await syncBuild(r);
                        if (capture && order.status === 'APPROVED' && !order.purchase_units[0].payments?.captures?.length) {
                            if (!clientId)
                                throw new ClientError(403, 'Client payment approval required.');
                            cfg(true);
                            await api(true)('/v2/checkout/orders/' + r.provider_id + '/capture', 'POST', {}, 'pb-capture-' + r.id);
                            await syncBuild(r);
                        }
                    }
                    else {
                        await syncMaintenance(r);
                        const end = new Date(now()).toISOString();
                        const start = new Date(now() - 31 * 86400000).toISOString();
                        const list = await api()('/v1/billing/subscriptions/' + r.provider_id + '/transactions?' + new URLSearchParams({ start_time: start, end_time: end }));
                        if (!Array.isArray(list.transactions) || list.transactions.length > 100)
                            throw Error('Transaction history unavailable');
                        for (const t of list.transactions.slice(-20)) {
                            if (typeof t.id === 'string')
                                await sale(r, t.id);
                        }
                    }
                    return view(id, clientId);
                }
                catch (error) {
                    if (error instanceof ClientError)
                        throw error;
                    throw new ClientError(502, 'Payment verification is incomplete. Refresh this project before attempting another payment.');
                }
            });
        },
        async cancel(clientId: string, id: string, input: any) {
            if (input?.consent !== true)
                throw new ClientError(400, 'Confirm cancellation of future maintenance renewals.');
            await clientLimit(clientId, 'project-cancel', 20);
            const r = await rowFor(id, 'maintenance', clientId);
            if (!r.provider_id)
                throw new ClientError(409, 'No maintenance subscription exists.');
            return lease(r, async (r) => {
                const s = await syncMaintenance(r);
                if (!['CANCELLED', 'EXPIRED'].includes(s.status))
                    await api()('/v1/billing/subscriptions/' + r.provider_id + '/cancel', 'POST', { reason: 'Client requested cancellation of future project maintenance renewals.' });
                await syncMaintenance(r);
                await audit(id, clientId, 'CANCEL_MAINTENANCE');
                return view(id, clientId);
            });
        },
        /** Called ONLY after the existing webhook has verified PayPal's signature. */
        async verifiedWebhook(event: any) {
            const db = await projectBillingDb();
            const resource = event.resource;
            let r: any;
            const id = typeof resource?.id === 'string' ? resource.id : '';
            const sub = typeof resource?.billing_agreement_id === 'string' ? resource.billing_agreement_id : '';
            const order = typeof resource?.supplementary_data?.related_ids?.order_id === 'string' ? resource.supplementary_data.related_ids.order_id : '';
            if (event.event_type?.startsWith('BILLING.SUBSCRIPTION.'))
                r = await db.get('SELECT * FROM ifcdc_project_billing WHERE kind=? AND provider_id=?', 'maintenance', id);
            if (event.event_type?.startsWith('PAYMENT.SALE.'))
                r = await db.get('SELECT b.* FROM ifcdc_project_billing b WHERE b.kind=? AND (b.provider_id=? OR b.id IN(SELECT billing_id FROM ifcdc_project_payments WHERE provider_id=?))', 'maintenance', sub, typeof resource.sale_id === 'string' ? resource.sale_id : id);
            if (event.event_type?.startsWith('PAYMENT.CAPTURE.'))
                r = await db.get('SELECT b.* FROM ifcdc_project_billing b WHERE b.kind=? AND (b.provider_id=? OR b.id IN(SELECT billing_id FROM ifcdc_project_payments WHERE provider_id=?))', 'build', order, id);
            if (!r)
                return;
            await rowFor(r.project_id, r.kind);
            await lease(r, async (row) => {
                if (row.kind === 'build')
                    await syncBuild(row);
                else {
                    await syncMaintenance(row);
                    if (event.event_type.startsWith('PAYMENT.SALE.'))
                        await sale(row, typeof resource.sale_id === 'string' ? resource.sale_id : id);
                }
            });
        }
    };
}
