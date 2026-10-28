import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hqApiFetch } from '../../api/hqApiFetch';
export default function ProjectBillingPanel({ projectId }: {
    projectId: string;
}) {
    const base = '/api/hq/client-projects/' + projectId + '/billing';
    const query = useQuery({ queryKey: ['project-billing', projectId], queryFn: () => hqApiFetch<any>(base), retry: false });
    const notificationQuery = useQuery({ queryKey: ['project-notifications', projectId], queryFn: () => hqApiFetch<any>('/api/hq/client-projects/' + projectId + '/notifications'), retry: false });
    const [sendConsent, setSendConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [consent, setConsent] = useState(false);
    const [startAt, setStartAt] = useState('');
    const [message, setMessage] = useState('');
    const b = query.data?.billing;
    const n = notificationQuery.data?.notifications;
    const money = (v: number) => '$' + (v / 100).toFixed(2);
    async function action(path: string, body: any) {
        if (busy)
            return;
        setBusy(true);
        try {
            await hqApiFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            setConsent(false);
            setMessage('Billing record saved. The client must authorize payment in their own workspace.');
            await query.refetch();
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Billing could not be confirmed.');
        }
        finally {
            setBusy(false);
        }
    }
    async function processEmails() { if (busy || !sendConsent)
        return; setBusy(true); try {
        await hqApiFetch('/api/hq/client-projects/' + projectId + '/notifications/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
        setSendConsent(false);
        setMessage('Project email queue checked. Review send status below; no payment was created or captured.');
        await notificationQuery.refetch();
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : 'Project email queue unavailable.');
    }
    finally {
        setBusy(false);
    } }
    return <section style={{ border: '1px solid #64748b', borderRadius: 12, padding: 16, margin: '1rem 0', overflowWrap: 'anywhere' }}><h4>Project payments &amp; maintenance</h4><button type="button" disabled={busy} onClick={() => { void query.refetch(); void notificationQuery.refetch(); }}>Refresh payment records</button>{query.isError ? <p role="alert">Billing records unavailable. {query.error instanceof Error ? query.error.message : 'Unknown request error.'} Refresh before releasing a payment.</p> : !b ? <p>Loading billing records…</p> : <><p>Project checkout: {b.enabled ? 'enabled' : 'disabled — configuration required'}</p><p>Only provider-verified COMPLETED transactions confirm payment. Subscription activation is separate from a paid monthly charge. Refunds and disputes are handled in PayPal.</p>{b.buildWaived && <p>Build fee waived.</p>}{b.monthlyWaived && <p>Monthly fee waived.</p>}{b.records.map((r: any) => <article key={r.id}><strong>{r.kind}: {money(r.cents)}{r.kind === 'maintenance' ? ' monthly' : ''} · {r.status}</strong><p>PayPal: {r.providerId || 'Not started'}{r.startAt ? ' · First charge ' + new Date(r.startAt).toLocaleString() : ''}</p>{r.providerId && <button type="button" disabled={busy} onClick={() => void action('/check', { kind: r.kind })}>Verify {r.kind} with PayPal</button>}</article>)}{b.quoteAccepted && b.enabled && <form onSubmit={e => e.preventDefault()}><label style={{ display: 'block', margin: '1rem 0' }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/> I am releasing the exact accepted fee and have reviewed the agreed scope, taxes and service start terms. This action does not charge the client.</label>{!b.buildWaived && !b.records.some((r: any) => r.kind === 'build') && <button type="button" disabled={busy || !consent} onClick={() => void action('', { kind: 'build', consent: true })}>Release accepted build payment</button>}{!b.monthlyWaived && !b.records.some((r: any) => r.kind === 'maintenance') && <><label style={{ display: 'block' }}>First maintenance charge (after approved delivery)<input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}/></label><button type="button" disabled={busy || !consent || !startAt} onClick={() => void action('', { kind: 'maintenance', consent: true, startAt: new Date(startAt).toISOString() })}>Release maintenance authorization</button><p>Choose a future date consistent with the accepted quote. The server requires approved delivery and a verified build payment (or waived build fee).</p></>}</form>}{b.payments.map((p: any) => <p key={p.id}>{p.kind} · {money(p.cents)} {p.currency} · {p.status} · {new Date(p.paidAt).toLocaleString()} · {p.id}</p>)}</>}<h4>Project email notifications</h4>{notificationQuery.isError ? <p role="alert">{notificationQuery.error instanceof Error ? notificationQuery.error.message : 'Notification status unavailable.'}</p> : n ? <><p>{n.enabled && n.configured ? 'Enabled with Postmark' : 'Disabled or missing configuration'}</p><p>{n.counts.map((c: any) => `${c.status}: ${c.count}`).join(' · ') || 'No queued project emails.'}</p>{n.worker && <p>Email worker: {n.worker.startedAt ? 'started' : 'not started'} · Last successful cycle: {n.worker.lastSuccessAt ? new Date(n.worker.lastSuccessAt).toLocaleString() : 'not recorded'}{n.worker.lastErrorCode ? ' · ' + n.worker.lastErrorCode : ''}</p>}
        <label style={{ display: 'block' }}><input type="checkbox" checked={sendConsent} onChange={e => setSendConsent(e.target.checked)}/> Send pending email notices for this project. Accepted or uncertain sends will not be resent.</label><button type="button" disabled={busy || !sendConsent || !n.enabled || !n.configured} onClick={() => void processEmails()}>Process this project's email queue</button>
        <p>ACCEPTED means Postmark accepted the email; it does not confirm inbox delivery. UNCERTAIN messages require a Postmark activity check before retrying.</p></> : <p>Loading notification status…</p>}<p role="status">{message}</p></section>;
}
