import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { ClientError, clientDb, clientLimit, readClientProject } from './clientPortal';
type Quote = {
    scope: string;
    buildCents: number;
    monthlyCents: number;
    maintenance: string;
    monthlyStart: string;
    cancellation: string;
    additionalCosts: string;
    timeline: string;
    validUntil: number;
};
type Delivery = {
    summary: string;
    previewUrl: string;
    handoffUrl: string;
    checks: string;
};
type State = {
    quote: Quote | null;
    quoteStatus: 'NONE' | 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';
    quoteDecisionAt: number | null;
    delivery: Delivery | null;
    deliveryStatus: 'NONE' | 'REVIEW' | 'CHANGES_REQUESTED' | 'ACCEPTED';
    deliveryResponse: string;
    deliveryDecisionAt: number | null;
};
const initial: State = { quote: null, quoteStatus: 'NONE', quoteDecisionAt: null, delivery: null, deliveryStatus: 'NONE', deliveryResponse: '', deliveryDecisionAt: null };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let opening: Promise<any> | undefined;
async function dbReady() {
    if (!opening)
        opening = clientDb().then(async (db) => {
            await db.exec(`
 CREATE TABLE IF NOT EXISTS ifcdc_client_engagements(project_id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0,state_json TEXT NOT NULL,actor_id TEXT NOT NULL,event TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS ifcdc_client_engagement_history(project_id TEXT NOT NULL,version INTEGER NOT NULL,state_json TEXT NOT NULL,actor_id TEXT NOT NULL,event TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(project_id,version));
 CREATE TRIGGER IF NOT EXISTS ifcdc_engagement_audit AFTER UPDATE ON ifcdc_client_engagements BEGIN
 INSERT INTO ifcdc_client_engagement_history VALUES(NEW.project_id,NEW.version,NEW.state_json,NEW.actor_id,NEW.event,NEW.updated_at); END;
 CREATE TABLE IF NOT EXISTS ifcdc_client_messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,project_id TEXT NOT NULL,actor_id TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_client_messages_project ON ifcdc_client_messages(project_id,sequence);
 `);
            return db;
        }).catch(error => { opening = undefined; throw error; });
    return opening;
}
async function project(id: string, clientId?: string) { if (!uuid.test(id))
    throw new ClientError(404, 'Project not found.'); if (clientId)
    await readClientProject(clientId, id); const db = await dbReady(); const row = await db.get('SELECT status FROM ifcdc_client_projects WHERE id=?', id); if (!row)
    throw new ClientError(404, 'Project not found.'); if (row.status === 'DRAFT')
    throw new ClientError(409, 'Submit the design before discussing scope or delivery.'); return db; }
async function record(db: any, id: string) { await db.run('INSERT OR IGNORE INTO ifcdc_client_engagements VALUES (?,0,?,?,?,?)', id, JSON.stringify(initial), 'system', 'CREATED', Date.now()); return db.get('SELECT * FROM ifcdc_client_engagements WHERE project_id=?', id); }
function view(row: any) { return { version: row.version, ...JSON.parse(row.state_json) as State, updatedAt: row.updated_at }; }
function text(value: unknown, max: number, min = 1) { if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    throw new ClientError(400, 'Complete the project details within the displayed limits.'); return value.trim(); }
export function quoteMoney(value: unknown, maximum: number) { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/.test(value))
    throw new ClientError(400, 'Use a USD amount with at most two decimal places.'); const [whole, fraction = ''] = value.split('.'); const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0')); if (cents > maximum)
    throw new ClientError(400, 'Amount exceeds the supported quote limit.'); return cents; }
export function deliveryUrl(input: unknown) { if (input === '')
    return ''; if (typeof input !== 'string' || input.length > 2000)
    throw new ClientError(400, 'Enter a valid HTTPS preview or handoff URL.'); let url: URL; try {
    url = new URL(input);
}
catch {
    throw new ClientError(400, 'Enter a valid HTTPS preview or handoff URL.');
} const host = url.hostname.toLowerCase(); if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host) || /^\d+(\.\d+)*$/.test(host))
    throw new ClientError(400, 'Use an HTTPS link on a public hostname, without credentials or a custom port.'); return url.href; }
function quote(input: any): Quote { if (!input)
    throw new ClientError(400, 'Add quote details.'); const validUntil = Date.parse(input.validUntil); if (!Number.isFinite(validUntil) || validUntil <= Date.now() || validUntil > Date.now() + 90 * 86400000)
    throw new ClientError(400, 'Quote expiry must be in the next 90 days.'); return { scope: text(input.scope, 4000, 10), buildCents: quoteMoney(input.buildAmount, 10000000), monthlyCents: quoteMoney(input.monthlyAmount, 1000000), maintenance: text(input.maintenance, 2000), monthlyStart: text(input.monthlyStart, 500), cancellation: text(input.cancellation, 1000), additionalCosts: text(input.additionalCosts, 1000), timeline: text(input.timeline, 1000), validUntil }; }
async function write(db: any, id: string, row: any, state: State, actorId: string, event: string) { const change = await db.run('UPDATE ifcdc_client_engagements SET state_json=?,version=version+1,actor_id=?,event=?,updated_at=? WHERE project_id=? AND version=?', JSON.stringify(state), actorId, event, Date.now(), id, row.version); if (!change.changes)
    throw new ClientError(409, 'Project terms changed. Refresh and review the latest details.'); return view(await db.get('SELECT * FROM ifcdc_client_engagements WHERE project_id=?', id)); }
function revision(row: any, input: any) { if (!Number.isInteger(input?.version) || input.version !== row.version)
    throw new ClientError(409, 'Project terms changed. Refresh and review the latest details.'); }
export async function readEngagement(id: string, clientId?: string) { const db = await project(id, clientId); return view(await record(db, id)); }
export async function founderEngagement(actorId: string, id: string, input: any) {
    const db = await project(id);
    const row = await record(db, id);
    revision(row, input);
    const state: State = JSON.parse(row.state_json);
    if (input.action === 'OFFER_QUOTE') {
        if (state.quoteStatus === 'ACCEPTED')
            throw new ClientError(409, 'Accepted terms are preserved. A separate change agreement is required.');
        state.quote = quote(input.quote);
        state.quoteStatus = 'OFFERED';
        state.quoteDecisionAt = null;
    }
    else if (input.action === 'WITHDRAW_QUOTE') {
        if (state.quoteStatus !== 'OFFERED')
            throw new ClientError(409, 'Only an unanswered quote can be withdrawn.');
        state.quoteStatus = 'WITHDRAWN';
    }
    else if (input.action === 'SHARE_DELIVERY') {
        if (state.quoteStatus !== 'ACCEPTED')
            throw new ClientError(409, 'The client must accept a quote before delivery review.');
        if (state.deliveryStatus === 'ACCEPTED')
            throw new ClientError(409, 'The accepted handoff is preserved.');
        const d = input.delivery;
        if (!d)
            throw new ClientError(400, 'Add delivery details.');
        const previewUrl = deliveryUrl(d.previewUrl);
        const handoffUrl = deliveryUrl(d.handoffUrl);
        if (!previewUrl && !handoffUrl)
            throw new ClientError(400, 'Add a preview or handoff link.');
        state.delivery = { summary: text(d.summary, 4000, 10), previewUrl, handoffUrl, checks: text(d.checks, 4000, 10) };
        state.deliveryStatus = 'REVIEW';
        state.deliveryResponse = '';
        state.deliveryDecisionAt = null;
    }
    else
        throw new ClientError(400, 'Choose a supported project action.');
    return write(db, id, row, state, actorId, input.action);
}
export async function clientEngagementDecision(clientId: string, id: string, input: any) {
    const db = await project(id, clientId);
    await clientLimit(clientId, 'project-decision', 100);
    const row = await record(db, id);
    revision(row, input);
    const state: State = JSON.parse(row.state_json);
    if (input.action === 'ACCEPT_QUOTE' || input.action === 'DECLINE_QUOTE') {
        if (!state.quote || state.quoteStatus !== 'OFFERED')
            throw new ClientError(409, 'This quote is no longer awaiting a decision.');
        if (state.quote.validUntil <= Date.now())
            throw new ClientError(409, 'This quote has expired. Ask IFCDC for an updated quote.');
        if (input.action === 'ACCEPT_QUOTE' && input.consent !== true)
            throw new ClientError(400, 'Confirm that you reviewed the scope and costs.');
        state.quoteStatus = input.action === 'ACCEPT_QUOTE' ? 'ACCEPTED' : 'DECLINED';
        state.quoteDecisionAt = Date.now();
    }
    else if (input.action === 'ACCEPT_DELIVERY' || input.action === 'REQUEST_CHANGES') {
        if (state.deliveryStatus !== 'REVIEW')
            throw new ClientError(409, 'No delivery is awaiting your review.');
        if (input.action === 'ACCEPT_DELIVERY' && input.consent !== true)
            throw new ClientError(400, 'Confirm that you reviewed the delivery.');
        state.deliveryResponse = text(input.note ?? '', 2000, input.action === 'REQUEST_CHANGES' ? 10 : 0);
        state.deliveryStatus = input.action === 'ACCEPT_DELIVERY' ? 'ACCEPTED' : 'CHANGES_REQUESTED';
        state.deliveryDecisionAt = Date.now();
    }
    else
        throw new ClientError(400, 'Choose a supported project decision.');
    return write(db, id, row, state, clientId, input.action);
}
export async function listProjectMessages(id: string, clientId?: string, after = 0) { const db = await project(id, clientId); if (!Number.isSafeInteger(after) || after < 0)
    throw new ClientError(400, 'Invalid message cursor.'); const rows = await db.all('SELECT sequence,id,author,body,created_at AS createdAt FROM ifcdc_client_messages WHERE project_id=? AND sequence>? ORDER BY sequence ASC LIMIT 101', id, after); return { messages: rows.slice(0, 100), hasMore: rows.length > 100, next: rows.length ? rows[Math.min(rows.length, 100) - 1].sequence : after }; }
export async function addProjectMessage(actorId: string, id: string, input: any, clientId?: string) { const db = await project(id, clientId); if (!uuid.test(input?.id))
    throw new ClientError(400, 'Invalid message reference.'); const body = text(input.body, 2000); await clientLimit(actorId, 'project-message', 100); const author = clientId ? 'CLIENT' : 'IFCDC'; const existing = await db.get('SELECT * FROM ifcdc_client_messages WHERE id=?', input.id); if (existing) {
    if (existing.project_id !== id || existing.actor_id !== actorId || existing.body !== body)
        throw new ClientError(409, 'Message reference already used.');
    return { sent: true };
} const inserted = await db.run('INSERT OR IGNORE INTO ifcdc_client_messages(id,project_id,actor_id,author,body,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM ifcdc_client_messages WHERE project_id=?)<1000', input.id, id, actorId, author, body, Date.now(), id); if (!inserted.changes) {
    const retry = await db.get('SELECT * FROM ifcdc_client_messages WHERE id=?', input.id);
    if (retry?.project_id === id && retry.actor_id === actorId && retry.body === body)
        return { sent: true };
    throw new ClientError(409, 'Message limit reached or message changed. Contact service@ifcdc.org.');
} return { sent: true }; }
export async function engagementHistory(id: string) { const db = await project(id); return db.all('SELECT version,event,created_at AS createdAt FROM ifcdc_client_engagement_history WHERE project_id=? ORDER BY version DESC LIMIT 100', id); }
