import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("Writer Studio blocks draft controls until eligibility is reviewed; review confirmation is separate from submission", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://hq.example.test/hq/grants" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const originalFetch = globalThis.fetch;
  let canDraft = false;
  const requests: { url: string; method?: string; body?: any }[] = [];
  const facts = ["legalName", "taxStatus", "serviceArea", "programs"].map((key) => ({ key, value: key === "legalName" ? "Imperial Foundation Community Development Center" : "Verified fact", sourceRef: "vault:document" }));
  const assessment = () => ({ status: canDraft ? "eligible" : "needs_review", canDraft, reasons: canDraft ? [] : ["Prior enforcement experience needs evidence."], profile: { facts, reviewedBy: "Founder", reviewedAt: "2026-10-23T01:00:00Z" }, review: null, opportunity: { id: "opp", title: "Test opportunity", url: "https://grants.gov/test" } });
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/auth/session")) return Response.json({ user: { id: "founder", role: "owner", email: "service@ifcdc.org", permissions: [], modules: ["grants"] } });
    if (url.endsWith("/eligibility-review")) return Response.json(assessment());
    if (url.endsWith("/verified-profile")) return Response.json({ profile: assessment().profile });
    if (url.endsWith("/ai-assist")) return Response.json({ content: "Proposed draft for review." });
    if (url.includes("/sections/")) return Response.json({ section: {} });
    if (url.includes("/writer-studio/")) return Response.json({ application: { id: "app", founder_approval_status: "pending" }, writerSections: { sections: [{ section_key: "executive_summary", section_label: "Executive Summary", content: "" }], completionPct: 0 } });
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { AuthProvider } = await import("../client/src/auth/AuthContext");
  const { GrantWriterStudioPanel } = await import("../client/src/components/hq/grants/GrantCenterEnterprisePanels");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const root = createRoot(document.getElementById("root")!);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
  const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label)!;
  try {
    await React.act(async () => { root.render(React.createElement(AuthProvider, { children: React.createElement(QueryClientProvider, { client: qc }, React.createElement(GrantWriterStudioPanel, { applications: [{ id: "app", title: "Test" }], selectedApplicationId: "app", onSelectApplication: () => {} })) })); await flush(); });
    await React.act(async () => { await flush(); });
    assert.equal(button("AURA Draft").disabled, true);
    assert.equal(button("Generate Full Proposal").disabled, true);
    assert.match(document.body.textContent!, /experience needs evidence/);
    assert.equal(button("Confirm organization facts").disabled, true);
    assert.equal(button("Save eligibility review").disabled, true);
    const attestation = [...document.querySelectorAll("label")].find((el) => el.textContent?.includes("I checked these facts"))!.querySelector("input")!;
    await React.act(async () => { attestation.click(); await flush(); });
    assert.equal(button("Confirm organization facts").disabled, false);
    assert.equal(button("Save eligibility review").disabled, true, "profile confirmation does not certify eligibility");
    canDraft = true;
    await React.act(async () => { await qc.invalidateQueries({ queryKey: ["grant-eligibility"] }); await flush(); });
    assert.equal(button("AURA Draft").disabled, false);
    assert.equal(button("Generate Full Proposal").disabled, false);
    await React.act(async () => { button("AURA Draft").click(); await flush(); });
    assert.equal(requests.filter((r) => r.url.endsWith("/ai-assist")).length, 1);
    assert.equal(requests.some((r) => /founder-approval|confirm-portal|submission/.test(r.url)), false);
  } finally {
    await React.act(async () => root.unmount()); qc.clear(); globalThis.fetch = originalFetch;
    dom.window.close();
    for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key]; }
  }
});
