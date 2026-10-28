/** Durable transactional outbox. No real transport is used by tests. */
import { clientDb, clientLimit } from './clientPortal';
import { getSuperAdminEmail } from '../config/credentials';
import { projectBillingDb, createProjectBillingService } from './projectBilling';
let notificationSchema: Promise<any> | undefined;
export function projectNotificationDb() {
    if (!notificationSchema)
        notificationSchema = initializeNotificationDb().catch(error => { notificationSchema = undefined; throw error; });
    return notificationSchema;
}
async function initializeNotificationDb() {
    const db = await projectBillingDb();
    await db.exec(`
CREATE TABLE IF NOT EXISTS ifcdc_project_notification_settings(id INTEGER PRIMARY KEY,installed_at INTEGER NOT NULL);
INSERT OR IGNORE INTO ifcdc_project_notification_settings VALUES(1,${Date.now()});
CREATE TABLE IF NOT EXISTS ifcdc_project_notifications(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'QUEUED',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,claimed_at INTEGER,message_id TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_notifications_due ON ifcdc_project_notifications(status,next_at);
CREATE TRIGGER IF NOT EXISTS ifcdc_project_submission_email AFTER UPDATE OF status ON ifcdc_client_projects WHEN OLD.status='DRAFT' AND NEW.status='SUBMITTED' BEGIN
INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at) VALUES('submission:'||NEW.id,NEW.id,'${getSuperAdminEmail().replace(/'/g, "''")}','IFCDC: new client project','A client submitted a project. Open the private HQ production queue. Project reference: '||NEW.id,NEW.updated_at); END;
`);
    return db;
}
export function projectNotificationConfiguration(env: NodeJS.ProcessEnv = process.env) { return { enabled: env.IFCDC_PROJECT_NOTIFICATIONS_ENABLED === 'true', configured: !!env.POSTMARK_SERVER_TOKEN?.trim() }; }
export async function seedProjectNotifications() {
    const db = await projectNotificationDb();
    const since = (await db.get('SELECT installed_at FROM ifcdc_project_notification_settings WHERE id=1')).installed_at;
    const founder = getSuperAdminEmail();
    // SQL inserts make event discovery repeatable across restarts and interrupted batches.
    await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'submission:'||p.id,p.id,?,'IFCDC: new client project','A client submitted a project. Open the private HQ production queue. Project reference: '||p.id,p.updated_at FROM ifcdc_client_projects p WHERE p.status='SUBMITTED' AND p.updated_at>=?`, founder, since);
    // Tables are owned by the engagement module; initialize once before discovery.
    const has = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='ifcdc_client_engagement_history'");
    if (has) {
        await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'decision:'||h.project_id||':'||h.version,h.project_id,CASE WHEN h.event IN('OFFER_QUOTE','WITHDRAW_QUOTE','SHARE_DELIVERY') THEN c.email ELSE ? END,'IFCDC: project update','Your project has an update ('||h.event||'). Sign in at https://ifcdc.org/client to review it. Founder: use your private HQ. Project reference: '||p.id,h.created_at FROM ifcdc_client_engagement_history h JOIN ifcdc_client_projects p ON p.id=h.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE h.created_at>=?`, founder, since);
    }
    const productionEvents=await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='ifcdc_production_events'");
    if(productionEvents){await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'production:'||e.id,e.project_id,CASE WHEN e.event IN('CLIENT_APPROVE','CLIENT_CHANGES') THEN ? ELSE c.email END,'IFCDC: website production update','Website project update: '||e.event||'. Sign in at https://ifcdc.org/client to review your website builds and hosted-site status. Founder: use private HQ. Project reference: '||p.id,e.created_at FROM ifcdc_production_events e JOIN ifcdc_client_projects p ON p.id=e.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE e.created_at>=? AND e.event!='BUILD_CREATED'`,founder,since);}
    const siteInquiries=await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='ifcdc_production_inquiries'");
    if(siteInquiries){await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'site-inquiry:'||r.id,r.project_id,c.email,'IFCDC: new website service request','A request is waiting in your private client workspace. Sign in at https://ifcdc.org/client. Project reference: '||p.id,r.created_at FROM ifcdc_production_inquiries r JOIN ifcdc_client_projects p ON p.id=r.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE r.created_at>=?`,since);}
    const messages = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='ifcdc_client_messages'");
    if (messages)
        await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'message:'||m.id,m.project_id,CASE WHEN m.author='CLIENT' THEN ? ELSE c.email END,'IFCDC: new project message','A new private project message is waiting. Sign in at https://ifcdc.org/client. Founder: use your private HQ. Project reference: '||p.id,m.created_at FROM ifcdc_client_messages m JOIN ifcdc_client_projects p ON p.id=m.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE m.created_at>=?`, founder, since);
    await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'progress:'||e.id,e.project_id,c.email,'IFCDC: project progress','Your project stage has changed. Sign in at https://ifcdc.org/client to review it. Project reference: '||p.id,e.created_at FROM ifcdc_client_events e JOIN ifcdc_client_projects p ON p.id=e.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE e.created_at>=?`, since);
    await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'release:'||b.id||':'||COALESCE(b.start_at,'once'),b.project_id,c.email,'IFCDC: project payment ready','Your accepted '||b.kind||' payment is ready for review in your private workspace. USD '||printf('%.2f',b.cents/100.0)||CASE WHEN b.kind='maintenance' THEN ' monthly, first charge '||b.start_at||'. Separate PayPal approval is required.' ELSE ' once. Payment approval is separate from quote acceptance.' END||' Sign in at https://ifcdc.org/client. Project reference: '||p.id,b.created_at FROM ifcdc_project_billing b JOIN ifcdc_client_projects p ON p.id=b.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE b.created_at>=?`, since);
    for (const audience of ['client', 'founder'])
        await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'receipt:${audience}:'||r.provider_id||':'||r.status,b.project_id,${audience === 'client' ? 'c.email' : '?'},'IFCDC: project payment record','PayPal-verified '||b.kind||' transaction: USD '||printf('%.2f',r.cents/100.0)||' / '||r.status||'. Transaction: '||r.provider_id||'. Payment time: '||r.paid_at||'. This is a service payment record, not a donation receipt. Review https://ifcdc.org/client or your private HQ. Project reference: '||p.id,r.updated_at FROM ifcdc_project_payments r JOIN ifcdc_project_billing b ON b.id=r.billing_id JOIN ifcdc_client_projects p ON p.id=b.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE r.updated_at>=?`, ...(audience === 'client' ? [since] : [founder, since]));
    await db.run(`INSERT OR IGNORE INTO ifcdc_project_notifications(id,project_id,recipient,subject,body,created_at)
 SELECT 'subscription:'||b.id||':'||b.status,b.project_id,c.email,'IFCDC: maintenance subscription status','Maintenance status: '||b.status||'. Subscription: '||b.provider_id||'. USD '||printf('%.2f',b.cents/100.0)||' monthly. First scheduled charge: '||b.start_at||'. Active authorization is not proof of a completed payment. Manage future renewals at https://ifcdc.org/client. Project reference: '||b.project_id,b.verified_at FROM ifcdc_project_billing b JOIN ifcdc_client_projects p ON p.id=b.project_id JOIN ifcdc_clients c ON c.id=p.client_id WHERE b.kind='maintenance' AND b.verified_at>=? AND b.status IN('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')`, since);
}
export async function projectNotificationStatus(id: string, env: NodeJS.ProcessEnv = process.env) { await seedProjectNotifications(); const db = await projectNotificationDb(); return { ...projectNotificationConfiguration(env), worker: { ...workerState }, counts: await db.all('SELECT status,COUNT(*) AS count FROM ifcdc_project_notifications WHERE project_id=? GROUP BY status', id) }; }
export async function deliverProjectNotifications(options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    now?: () => number;
    projectId?: string;
} = {}) {
    const env = options.env || process.env;
    const now = options.now || Date.now;
    const config = projectNotificationConfiguration(env);
    await seedProjectNotifications();
    if (!config.enabled || !config.configured)
        return;
    const db = await projectNotificationDb();
    await db.run("UPDATE ifcdc_project_notifications SET status='UNCERTAIN' WHERE status='SENDING' AND claimed_at<?", now() - 120000);
    const rows = await db.all("SELECT * FROM ifcdc_project_notifications WHERE status IN('QUEUED','FAILED') AND attempts<5 AND next_at<=?" + (options.projectId ? ' AND project_id=?' : '') + " ORDER BY created_at LIMIT 5", ...[now(), ...(options.projectId ? [options.projectId] : [])]);
    for (const row of rows) {
        if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(row.recipient)) {
            await db.run("UPDATE ifcdc_project_notifications SET status='INVALID_RECIPIENT' WHERE id=?", row.id);
            continue;
        }
        try {
            await clientLimit('project-notifications', 'outbound', 100);
            await clientLimit(row.recipient, 'project-alert', 20);
        }
        catch {
            continue;
        }
        const claim = await db.run("UPDATE ifcdc_project_notifications SET status='SENDING',attempts=attempts+1,claimed_at=? WHERE id=? AND status IN('QUEUED','FAILED')", now(), row.id);
        if (!claim.changes)
            continue;
        let state = 'UNCERTAIN';
        let messageId = null;
        try {
            const response = await (options.fetchImpl || fetch)('https://api.postmarkapp.com/email', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN!.trim() }, body: JSON.stringify({ From: 'IFCDC Projects <service@ifcdc.org>', To: row.recipient, Subject: row.subject, TextBody: row.body, MessageStream: 'outbound', Tag: 'ifcdc-project', TrackOpens: false, TrackLinks: 'None', Metadata: { notification: row.id.slice(0, 255), project: row.project_id } }) });
            const data: any = await response.json();
            if (response.ok && data.ErrorCode === 0 && typeof data.MessageID === 'string' && data.MessageID.length <= 100) {
                state = 'ACCEPTED';
                messageId = data.MessageID;
            }
            else if (response.status >= 400 && response.status < 500 && Number.isInteger(data.ErrorCode) && data.ErrorCode !== 0)
                state = 'FAILED';
        }
        catch { }
        await db.run('UPDATE ifcdc_project_notifications SET status=?,message_id=?,next_at=? WHERE id=?', state, messageId, now() + 3600000 * Math.min(24, 2 ** row.attempts), row.id);
    }
}
const workerState = { startedAt: null as number | null, lastCycleAt: null as number | null, lastSuccessAt: null as number | null, lastErrorCode: '' };
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let ticks = 0;
export function startProjectRevenueWorker() {
    if (timer || process.env.NODE_ENV !== 'production')
        return;
    workerState.startedAt = Date.now();
    const tick = async () => {
        if (running)
            return;
        running = true;
        workerState.lastCycleAt = Date.now();
        try {
            await projectNotificationDb();
            if (process.env.IFCDC_PROJECT_PAYMENTS_ENABLED === 'true' && ticks++ % 10 === 0) {
                const db = await clientDb();
                const rows = await db.all("SELECT project_id,kind FROM ifcdc_project_billing WHERE provider_id IS NOT NULL AND (verified_at IS NULL OR verified_at<?) AND status NOT IN('CANCELLED','EXPIRED','REFUNDED','VOIDED','DECLINED','FAILED') ORDER BY COALESCE(verified_at,0) LIMIT 3", Date.now() - 300000);
                const service = createProjectBillingService();
                for (const row of rows) {
                    try {
                        await service.recheck(undefined, row.project_id, row.kind);
                    }
                    catch { /* Keep record for the next reconciliation; never issue another payment. */ }
                }
            }
            await deliverProjectNotifications();
            workerState.lastSuccessAt = Date.now();
            workerState.lastErrorCode = '';
        }
        catch (error: any) {
            workerState.lastErrorCode = typeof error?.code === 'string' && /^SQLITE_[A-Z_]+$/.test(error.code) ? error.code : 'WORKER_CYCLE_FAILED';
            console.warn('IFCDC project revenue worker could not complete this cycle; saved records are retained.');
        }
        finally {
            running = false;
        }
    };
    void tick();
    timer = setInterval(() => void tick(), 30000);
    timer.unref();
}
