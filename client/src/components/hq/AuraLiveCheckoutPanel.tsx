import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hqApiFetch } from "../../api/hqApiFetch";

type Receipt = { id: string; status: string; environment: string; amount: string; currency: string;
  orderId: string | null; captureId: string | null; createdAt: number; verifiedAt: number | null; expiresAt: number };
type Status = { ready: boolean; configured: boolean; records: Receipt[] };
type Pending = { attemptId: string; state: string; id?: string; orderId?: string };
const base = "/api/hq/aura/software-engineering/live-checkout";
const storageKey = "ifcdc-live-checkout-attempt";
const validState = (value: string) => /^[a-f0-9]{64}$/.test(value);
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const post = <T,>(path: string, body: object) => hqApiFetch<T>(base + path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 30_000,
});
function loadPending(): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    return value && uuid(value.attemptId) && validState(value.state) ? value : null;
  } catch { return null; }
}
function safeApproval(value: string, orderId?: string) {
  const url = new URL(value);
  if (url.origin !== "https://www.paypal.com" || url.username || url.password || url.hash ||
      url.pathname !== "/checkoutnow" || url.searchParams.getAll("token").length !== 1 || url.searchParams.get("token") !== orderId) {
    throw new Error("PayPal returned an unexpected checkout address.");
  }
  return url.href;
}
export default function AuraLiveCheckoutPanel() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(loadPending);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const status = useQuery({ queryKey: ["aura-live-checkout"], queryFn: () => hqApiFetch<Status>(base + "/status"), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["aura-live-checkout"] });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("live_checkout")) return;
    const id = url.searchParams.get("live_checkout") || "";
    const state = url.searchParams.get("live_checkout_state") || "";
    const token = url.searchParams.get("token") || "";
    const result = url.searchParams.get("live_checkout_result");
    const saved = loadPending();
    if (uuid(id) && validState(state) && saved?.state === state && (!saved.id || saved.id === id) &&
        (result === "cancelled" || (/^[A-Z0-9]{1,36}$/.test(token) && (!saved.orderId || saved.orderId === token)))) {
      const next = { ...saved, id, orderId: token || saved.orderId };
      sessionStorage.setItem(storageKey, JSON.stringify(next)); setPending(next);
      setCancelled(result === "cancelled");
      setMessage(result === "cancelled" ? "Checkout cancelled. No payment has been confirmed." : "Returned from PayPal. Complete the live payment below to verify the result.");
    } else setMessage("The checkout return could not be matched. Use Recheck payment on your existing record before starting another payment.");
    for (const key of ["live_checkout", "live_checkout_state", "live_checkout_result", "token", "PayerID"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    void refresh();
  }, []);
  async function start() {
    setBusy(true); setMessage("");
    try {
      let attempt = pending;
      if (!attempt) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        attempt = { attemptId: crypto.randomUUID(), state: Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("") };
      }
      // Persist before sending: a timeout must retry the same idempotency attempt.
      sessionStorage.setItem(storageKey, JSON.stringify(attempt)); setPending(attempt);
      const result = await post<Receipt & { approvalUrl: string | null }>("/orders", { attemptId: attempt.attemptId, state: attempt.state, approved: true, liveAcknowledged: true });
      const next = { ...attempt, id: result.id, orderId: result.orderId || undefined };
      sessionStorage.setItem(storageKey, JSON.stringify(next)); setPending(next);
      if (result.status === "completed") { setMessage("This live payment is already verified."); await refresh(); }
      else if (result.approvalUrl) window.location.assign(safeApproval(result.approvalUrl, next.orderId));
      else throw new Error("PayPal approval is unavailable. Recheck the existing record.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Checkout could not start."); }
    finally { setBusy(false); setApproved(false); }
  }
  async function capture() {
    if (!pending?.id || !pending.orderId) return;
    setBusy(true);
    try {
      await post<Receipt>(`/orders/${pending.id}/capture`, { state: pending.state, orderId: pending.orderId, approved: true, liveAcknowledged: true });
      setMessage("Live payment verified by PayPal. The payment receipt is saved below.");
      sessionStorage.removeItem(storageKey); setPending(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Payment is not confirmed."); }
    finally { setBusy(false); setApproved(false); await refresh(); }
  }
  async function recheck(id: string) {
    setBusy(true);
    try {
      await post<Receipt>(`/orders/${id}/recheck`, {});
      setMessage("PayPal verified this live payment. The receipt is saved below.");
      if (pending?.id === id) { sessionStorage.removeItem(storageKey); setPending(null); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Payment is not confirmed."); }
    finally { setBusy(false); await refresh(); }
  }
  const matching = status.data?.records.find(row => row.id === pending?.id);
  const completed = matching?.status === "completed";
  const active = pending?.id && pending.orderId && !completed && !cancelled;
  return <section aria-label="AURA live checkout" style={{ display: "grid", gap: "0.8rem", maxWidth: "48rem" }}>
    <p style={{ margin: 0 }}><strong>USD 1.00 live verification checkout</strong> — LIVE PayPal payment. Real money will be charged.</p>
    {status.isLoading && <p role="status">Checking live checkout availability…</p>}
    {status.error && <p role="alert">{status.error.message}</p>}
    {status.data && !status.data.ready && <p>Live checkout is disabled or needs configuration. Founder activation is required.</p>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {status.data?.ready && <>
      <label style={{ display: "flex", alignItems: "start", gap: "0.5rem" }}>
        <input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)} />
        I authorize this real USD 1.00 payment to IFCDC through PayPal. This is a live transaction.
      </label>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="hq-btn hq-btn-primary" disabled={!approved || busy || completed} onClick={() => void start()}>
          {pending ? "Continue existing live checkout" : "Start live checkout"}
        </button>
        {active && <button className="hq-btn hq-btn-primary" disabled={!approved || busy} onClick={() => void capture()}>Complete live payment</button>}
      </div>
    </>}
    {!!status.data?.records.length && <div>
      <h3>Live payment records</h3>
      <ul style={{ paddingLeft: "1.2rem", overflowWrap: "anywhere" }}>
        {status.data.records.map(row => <li key={row.id} style={{ marginBottom: "1rem" }}>
          <strong>{row.status === "completed" ? "Verified live payment" : "Payment not confirmed"}</strong> — USD 1.00
          <div>Checkout: {row.id}</div>
          {row.orderId && <div>PayPal order: {row.orderId}</div>}
          {row.captureId && <div>Capture: {row.captureId}</div>}
          {row.verifiedAt && <div>Verified: {new Date(row.verifiedAt).toLocaleString()}</div>}
          {row.orderId && row.status !== "completed" && <button className="hq-btn" disabled={busy || !status.data.configured} onClick={() => void recheck(row.id)}>Recheck payment</button>}
        </li>)}
      </ul>
    </div>}
    {pending && <button className="hq-btn" disabled={busy} onClick={() => {
      if (!window.confirm("Start a separate live payment? First recheck any unconfirmed payment above to avoid repeating a checkout.")) return;
      sessionStorage.removeItem(storageKey); setPending(null); setApproved(false); setCancelled(false);
      setMessage("Ready for a separate real payment. Existing payment records are preserved.");
    }}>Start a separate live payment</button>}
  </section>;
}
