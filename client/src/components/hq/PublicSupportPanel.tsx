import React from "react";
import { useQuery } from "@tanstack/react-query";
import { hqApiFetch } from "../../api/hqApiFetch";
type Data = { ready: boolean; enabled: boolean; configured: boolean; webhookConfigured: boolean; bookConfigured: boolean;
  inquiries: { id: string; name: string; email: string; service: string; message: string; created_at: number }[];
  records: { id: string; kind: string; cents: number; status: string; provider_id: string; email?: string }[];
  ledger: { provider_id: string; cents: number; status: string }[] };
export default function PublicSupportPanel() {
  const query = useQuery({ queryKey: ["ifcdc-public-support"], queryFn: () => hqApiFetch<Data>("/api/public/support/admin"), retry: false, refetchInterval: 60_000 });
  return <section className="hq-panel" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
    <h2>IFCDC public support &amp; services</h2>
    <p><a href="/support" target="_blank" rel="noreferrer">Preview public support page ↗</a> · <button className="hq-btn hq-btn-secondary" onClick={() => void query.refetch()}>Refresh records</button></p>
    {query.isError ? <p>Founder access is required to view public payment and project records.</p> : !query.data ? <p>Loading support records…</p> : <>
      <p>{query.data.ready ? "Public payments enabled" : "Public payments disabled or incomplete"} · Credentials {query.data.configured ? "configured" : "missing"} · Webhook {query.data.webhookConfigured ? "configured" : "missing"} · Amazon listing {query.data.bookConfigured ? "configured" : "needed"}</p>
      <h3>Project quote requests</h3>
      {!query.data.inquiries.length && <p>No project requests yet.</p>}
      {query.data.inquiries.map(item => <article key={item.id} style={{ borderTop: "1px solid #555", padding: "0.75rem 0", overflowWrap: "anywhere" }}><strong>{item.service} — {item.name}</strong><p>{item.email} · {new Date(item.created_at).toLocaleString()}</p><p style={{ whiteSpace: "pre-wrap" }}>{item.message}</p><small>{item.id}</small></article>)}
      <h3>Recent donations &amp; memberships</h3>
      {query.data.records.map(item => <p key={item.id} style={{ overflowWrap: "anywhere" }}>{item.kind} · USD {(item.cents / 100).toFixed(2)} · {item.status} · {item.provider_id || item.id}{item.email ? ` · ${item.email}` : ""}</p>)}
      <h3>Provider-verified transactions</h3>
      {query.data.ledger.map(item => <p key={item.provider_id}>{item.provider_id} · USD {(item.cents / 100).toFixed(2)} · {item.status}</p>)}
      <p>Membership activation is separate from a paid transaction. Fulfill project updates and the monthly newsletter for active supporters. Handle refund requests and disputes in PayPal.</p>
    </>}
  </section>;
}
