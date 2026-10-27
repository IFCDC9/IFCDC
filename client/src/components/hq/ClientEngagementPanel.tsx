import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hqApiFetch } from '../../api/hqApiFetch';
const fields = [['scope', 'Scope & deliverables', 4000], ['buildAmount', 'One-time build cost (USD)', 20], ['monthlyAmount', 'Monthly maintenance cost (USD)', 20], ['maintenance', 'Maintenance includes / limits', 2000], ['monthlyStart', 'When monthly service begins', 500], ['cancellation', 'Cancellation terms', 1000], ['additionalCosts', 'Taxes and third-party / usage costs', 1000], ['timeline', 'Production schedule', 1000], ['validUntil', 'Offer expiry', 30]] as const;
const initialQuote = { scope: '', buildAmount: '', monthlyAmount: '', maintenance: '', monthlyStart: '', cancellation: '', additionalCosts: '', timeline: '', validUntil: '' };
const initialDelivery = { summary: '', previewUrl: '', handoffUrl: '', checks: '' };
export default function ClientEngagementPanel({ projectId }: {
    projectId: string;
}) {
    const base = '/api/hq/client-projects/' + projectId;
    const query = useQuery({ queryKey: ['client-engagement', projectId], queryFn: () => hqApiFetch<any>(base + '/engagement'), retry: false });
    const [quote, setQuote] = useState(initialQuote);
    const [delivery, setDelivery] = useState(initialDelivery);
    const [mode, setMode] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState<any[]>([]);
    const [cursor, setCursor] = useState(0);
    const [more, setMore] = useState(true);
    const [body, setBody] = useState('');
    const [pending, setPending] = useState<{
        id: string;
        body: string;
    } | null>(null);
    const engagement = query.data?.engagement;
    async function action(action: string) { if (!engagement || busy)
        return; setBusy(true); try {
        await hqApiFetch(base + '/engagement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: engagement.version, action, ...(action === 'OFFER_QUOTE' ? { quote: { ...quote, validUntil: new Date(quote.validUntil).toISOString() } } : {}), ...(action === 'SHARE_DELIVERY' ? { delivery } : {}) }) });
        setMode('');
        setMessage('Saved to the client workspace. No payment collected or recurring billing activated.');
        await query.refetch();
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Update failed.');
    }
    finally {
        setBusy(false);
    } }
    async function loadMessages() { setBusy(true); try {
        const result = await hqApiFetch<any>(base + '/messages?after=' + cursor);
        setMessages(previous => [...previous, ...result.messages]);
        setCursor(result.next);
        setMore(result.hasMore);
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Messages unavailable.');
    }
    finally {
        setBusy(false);
    } }
    async function send(event: React.FormEvent) { event.preventDefault(); if (busy)
        return; const request = pending?.body === body.trim() ? pending : { id: crypto.randomUUID(), body: body.trim() }; setPending(request); setBusy(true); try {
        await hqApiFetch(base + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
        setBody('');
        setPending(null);
        setMessage('Message saved. The client can read it in their workspace.');
        const result = await hqApiFetch<any>(base + '/messages?after=' + cursor);
        setMessages(previous => [...previous, ...result.messages]);
        setCursor(result.next);
        setMore(result.hasMore);
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Message failed. Retry to check the same message.');
    }
    finally {
        setBusy(false);
    } }
    const style = { display: 'block', width: '100%', background: 'var(--hq-bg)', color: 'var(--hq-text)', padding: 10, border: '1px solid #64748b', borderRadius: 8 } as const;
    return <section style={{ padding: '1rem', border: '1px solid #64748b', margin: '1rem 0', borderRadius: 12 }}><h3>Client scope, costs & handoff</h3><p>Quotes are project-specific. Approval records terms; payment collection and recurring authorization are separate. Share only client-ready links with the appropriate access controls.</p>{query.isError ? <p role="alert">Project details could not be loaded. <button type="button" onClick={() => void query.refetch()}>Retry</button></p> : !engagement ? <p>Loading project details…</p> : <><button type="button" className="hq-btn hq-btn-secondary" disabled={busy} onClick={() => void query.refetch()}>Refresh terms &amp; decisions</button><p>Quote: <strong>{engagement.quoteStatus}</strong> · Delivery: <strong>{engagement.deliveryStatus}</strong></p>{engagement.quote && <details><summary>Current quote</summary>{Object.entries(engagement.quote).map(([key, value]) => <p key={key}>{key}: {key.endsWith('Cents') ? '$' + (Number(value) / 100).toFixed(2) : key === 'validUntil' ? new Date(Number(value)).toLocaleString() : String(value)}</p>)}</details>}{engagement.quoteStatus !== 'ACCEPTED' && <button type="button" className="hq-btn hq-btn-secondary" disabled={busy} onClick={() => { setMode('quote'); setQuote(initialQuote); }}>Prepare / replace quote</button>}{engagement.quoteStatus === 'OFFERED' && <button type="button" className="hq-btn hq-btn-secondary" disabled={busy} onClick={() => void action('WITHDRAW_QUOTE')}>Withdraw unanswered quote</button>}{engagement.quoteStatus === 'ACCEPTED' && engagement.deliveryStatus !== 'ACCEPTED' && <button type="button" className="hq-btn hq-btn-secondary" disabled={busy} onClick={() => { setMode('delivery'); setDelivery(engagement.delivery || initialDelivery); }}>Share preview / handoff</button>}{engagement.delivery && <details><summary>Current delivery</summary><p>{engagement.delivery.summary}</p><p>{engagement.delivery.checks}</p><p>Client review: {engagement.deliveryResponse || 'Awaiting review'}</p></details>}
        {mode === 'quote' && <form onSubmit={event => { event.preventDefault(); void action('OFFER_QUOTE'); }}><h4>Issue a quote in USD</h4>{fields.map(([key, label, max]) => <label key={key} style={{ display: 'block', margin: '1rem 0' }}>{label}{['buildAmount', 'monthlyAmount', 'validUntil'].includes(key) ? <input style={style} required maxLength={max} type={key === 'validUntil' ? 'datetime-local' : 'text'} inputMode={key === 'validUntil' ? undefined : 'decimal'} pattern={key === 'validUntil' ? undefined : '(0|[1-9][0-9]{0,5})([.][0-9]{1,2})?'} value={quote[key]} onChange={event => setQuote({ ...quote, [key]: event.target.value })}/> : <textarea style={style} required maxLength={max} rows={3} value={quote[key]} onChange={event => setQuote({ ...quote, [key]: event.target.value })}/>}</label>)}<p>Maximum build cost $100,000; maximum monthly cost $10,000. Use 0 for a waived fee. The offer expires within 90 days. Be explicit about taxes, hosting, domains, email, AI usage, and included revisions.</p><button className="hq-btn hq-btn-primary" disabled={busy}>Issue quote for client review</button><button className="hq-btn hq-btn-secondary" type="button" onClick={() => setMode('')}>Cancel</button></form>}
        {mode === 'delivery' && <form onSubmit={event => { event.preventDefault(); void action('SHARE_DELIVERY'); }}><h4>Share delivery for review</h4>{([['summary', 'What is included', 4000], ['previewUrl', 'HTTPS preview URL (optional)', 2000], ['handoffUrl', 'HTTPS handoff URL (optional)', 2000], ['checks', 'Tests completed and known limitations', 4000]] as const).map(([key, label, max]) => <label key={key} style={{ display: 'block', margin: '1rem 0' }}>{label}{key.endsWith('Url') ? <input style={style} type="url" maxLength={max} value={delivery[key]} onChange={event => setDelivery({ ...delivery, [key]: event.target.value })}/> : <textarea style={style} required minLength={10} maxLength={max} rows={3} value={delivery[key]} onChange={event => setDelivery({ ...delivery, [key]: event.target.value })}/>}</label>)}<p>Provide at least one link. IFCDC stores the link privately; the external service controls file access. Do not put credentials or API secrets in links.</p><button className="hq-btn hq-btn-primary" disabled={busy}>Share delivery for client review</button><button className="hq-btn hq-btn-secondary" type="button" onClick={() => setMode('')}>Cancel</button></form>}
        <details><summary>Decision history</summary>{query.data.history.map((event: any) => <p key={event.version}>Revision {event.version}: {event.event.replaceAll('_', ' ')} · {new Date(event.createdAt).toLocaleString()}</p>)}</details></>}
    <h4>Client conversation</h4><p>Replies stay in the project workspace. Email notifications are not enabled.</p>{messages.map(row => <article key={row.id} style={{ borderTop: '1px solid #64748b', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><strong>{row.author} · {new Date(row.createdAt).toLocaleString()}</strong><p>{row.body}</p></article>)}{more && <button type="button" className="hq-btn hq-btn-secondary" disabled={busy} onClick={() => void loadMessages()}>Load messages</button>}<form onSubmit={event => void send(event)}><label>Message visible to this client<textarea style={style} required maxLength={2000} rows={3} value={body} onChange={event => setBody(event.target.value)}/></label><button className="hq-btn hq-btn-primary" disabled={busy}>Send project message</button></form><p role="status">{message}</p></section>;
}
