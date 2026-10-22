import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("AURA drafts remain unapproved and late responses cannot overwrite edited work", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://hq.example.test" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const originalFetch = globalThis.fetch;
  let finish: ((response: Response) => void) | undefined;
  const posts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/runners") && !options?.method) return Response.json({ runners: [], jobs: [] });
    posts.push(url);
    assert.ok(url.endsWith("/runner-change-draft"), "draft must never queue staging or tests");
    return new Promise<Response>((resolve) => { finish = resolve; });
  }) as typeof fetch;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { default: Panel } = await import("../client/src/components/hq/AuraRunnerPanel.tsx");
  const root = createRoot(document.getElementById("root")!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 15));
  const change = async (label: string, value: string) => {
    const element = document.querySelector(`textarea[aria-label="${label}"]`) as HTMLTextAreaElement;
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await flush();
    });
  };
  const clickDraft = async () => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Draft changes for review")!;
    assert.equal(button.disabled, false);
    await React.act(async () => { button.click(); await flush(); });
    assert.ok(finish);
  };
  const complete = async (summary: string) => {
    await React.act(async () => {
      finish!(Response.json({ changePackage: { version: 1, summary, files: [] } }));
      await flush();
    });
  };
  try {
    await React.act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Panel))); await flush(); });
    await change("AURA change instruction", "Change a label");
    await change("Source files for AURA draft", "client/src/example.tsx");
    await clickDraft();
    await complete("First draft");
    const json = document.querySelector('textarea[aria-label="Change package JSON"]') as HTMLTextAreaElement;
    assert.match(json.value, /First draft/);
    assert.equal(document.body.textContent?.includes("Package SHA-256:"), false, "draft still requires explicit validation");
    assert.ok([...document.querySelectorAll('input[type="checkbox"]')].every((item) => !(item as HTMLInputElement).checked));
    await clickDraft();
    await change("Change package JSON", "My manual edits");
    await complete("Obsolete draft");
    assert.equal(json.value, "My manual edits");
    assert.match(document.body.textContent ?? "", /Draft discarded/);
    assert.equal(posts.length, 2);
  } finally {
    await React.act(async () => root.unmount());
    client.clear(); globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
