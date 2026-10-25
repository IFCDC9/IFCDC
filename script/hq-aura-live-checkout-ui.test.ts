import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

async function exercise(result = "approved", ready = true) {
  const state = "a".repeat(64), id = "11111111-1111-4111-8111-111111111111", attemptId = "22222222-2222-4222-8222-222222222222";
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://hq.example.test/hq/software-engineering?live_checkout=${id}&live_checkout_state=${state}&live_checkout_result=${result}&token=ORDER123&PayerID=PAYER`,
  });
  dom.window.sessionStorage.setItem("ifcdc-live-checkout-attempt", JSON.stringify({ attemptId, state, id, orderId: "ORDER123" }));
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const savedFetch = globalThis.fetch; const requests: any[] = [];
  let receipt = { id, orderId: "ORDER123", captureId: null as string | null, status: "awaiting_approval", amount: "1.00", currency: "USD", verifiedAt: null as number | null };
  globalThis.fetch = (async (input: any, options: any) => {
    if (options?.method === "POST") {
      requests.push({ url: String(input), body: JSON.parse(options.body) });
      receipt = { ...receipt, status: "completed", captureId: "CAP123", verifiedAt: Date.now() };
      return Response.json(receipt);
    }
    return Response.json({ ready, configured: true, records: [receipt] });
  }) as typeof fetch;
  const React = await import("react"); const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { default: Panel } = await import("../client/src/components/hq/AuraLiveCheckoutPanel.tsx");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(document.getElementById("root")!);
  const flush = () => new Promise(resolve => setTimeout(resolve, 20));
  const button = (label: string) => [...document.querySelectorAll("button")].find(el => el.textContent === label)!;
  try {
    await React.act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Panel))); await flush(); });
    await React.act(async () => { await flush(); });
    assert.equal(requests.length, 0, "approval return never auto-captures");
    assert.equal(window.location.search, "", "callback state and payer fields removed from browser URL");
    assert.ok(document.body.textContent?.includes("Payment not confirmed"));
    assert.ok(document.body.textContent?.includes("Real money will be charged"));
    if (!ready) {
      assert.equal(button("Complete live payment"), undefined);
      assert.equal(button("Start live checkout"), undefined);
      return;
    }
    if (result === "cancelled") {
      assert.equal(button("Complete live payment"), undefined);
      assert.ok(document.body.textContent?.includes("Checkout cancelled"));
      assert.equal(requests.length, 0);
      return;
    }
    assert.equal(button("Complete live payment").disabled, true);
    await React.act(async () => { (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); await flush(); });
    await React.act(async () => { button("Complete live payment").click(); await flush(); });
    await React.act(async () => { await flush(); });
    assert.equal(requests.length, 1); assert.ok(requests[0].url.endsWith(`/orders/${id}/capture`));
    assert.deepEqual(requests[0].body, { state, orderId: "ORDER123", approved: true, liveAcknowledged: true });
    assert.ok(document.body.textContent?.includes("Verified live payment"));
    assert.ok(document.body.textContent?.includes("CAP123"));
    assert.equal(sessionStorage.getItem("ifcdc-live-checkout-attempt"), null);
  } finally {
    await React.act(async () => root.unmount()); client.clear(); globalThis.fetch = savedFetch; dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}
test("live return requires separate real-payment approval, then shows the server-verified receipt", () => exercise());
test("live cancellation sends no capture and offers no completion button", () => exercise("cancelled"));
test("disabled live checkout cannot offer create or capture even after a valid return", () => exercise("approved", false));
