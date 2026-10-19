/**
 * Grant Center tab panels.
 * Clicks Opportunity Finder and asserts its panel replaces Founder funding view.
 * No network, no mail, no grant submit, no payment, no production cookies.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { grantCallFailureText } from "../client/src/components/hq/grants/grantCallFailure.ts";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(public url: string) {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.({});
    });
  }
  send() {}
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }
  addEventListener() {}
  removeEventListener() {}
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://127.0.0.1:5000/hq/grants",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const assign = (key: string, value: unknown) => {
    Object.defineProperty(globals, key, { value, configurable: true, writable: true });
  };
  assign("window", window);
  assign("document", window.document);
  assign("HTMLElement", window.HTMLElement);
  assign("Element", window.Element);
  assign("Node", window.Node);
  assign("DocumentFragment", window.DocumentFragment);
  assign("SVGElement", window.SVGElement);
  assign("MutationObserver", window.MutationObserver);
  assign("getComputedStyle", window.getComputedStyle.bind(window));
  assign("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0));
  assign("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  assign("IS_REACT_ACT_ENVIRONMENT", true);
  assign("WebSocket", FakeWebSocket);
  window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  window.matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  return { root: window.document.getElementById("root")!, close: () => window.close() };
}

function hangOrForbid(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes("/center/opportunity-finder")) {
    return Promise.resolve(new Response(JSON.stringify({ error: "Founder Mode required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }));
  }
  return new Promise(() => {});
}

async function renderGrantCenter(root: HTMLElement) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { MemoryRouter } = await import("react-router-dom");
  const { default: GrantCenterPage } = await import("../client/src/pages/hq/GrantCenterPage.tsx");
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const reactRoot = createRoot(root);
  await React.act(async () => {
    reactRoot.render(
      React.createElement(QueryClientProvider, { client },
        React.createElement(MemoryRouter, { initialEntries: ["/hq/grants"] },
          React.createElement(GrantCenterPage),
        ),
      ),
    );
  });
  return { React, reactRoot, client };
}

test("forbidden grant reads are labeled as permission failures", () => {
  const error = new Error("Founder Mode required") as Error & { status: number };
  error.status = 403;
  assert.equal(grantCallFailureText(error, "fallback"), "Permission required. Founder Mode required");
});

test("Opportunity Finder click shows the finder panel and hides Founder funding view", async () => {
  const { root, close } = installDom();
  globalThis.fetch = hangOrForbid as typeof fetch;
  const { React, reactRoot, client } = await renderGrantCenter(root);
  try {

  assert.match(document.body.textContent ?? "", /Founder funding view/);
  assert.equal(document.querySelector("[data-grant-panel='opportunity-finder']"), null);
  assert.match(document.querySelector(".hq-tab.active")?.textContent ?? "", /Executive Dashboard/);

  const finderTab = [...document.querySelectorAll("button.hq-tab")].find((button) =>
    button.textContent?.includes("Opportunity Finder"),
  );
  assert.ok(finderTab, "Opportunity Finder tab button");

  await React.act(async () => {
    (finderTab as HTMLButtonElement).click();
  });

  const active = document.querySelector("[data-grant-tab]")?.getAttribute("data-grant-tab");
  assert.equal(active, "discover");
  assert.match(document.querySelector(".hq-tab.active")?.textContent ?? "", /Opportunity Finder/);
  assert.ok(document.querySelector("[data-grant-panel='opportunity-finder']"));
  assert.match(document.body.textContent ?? "", /Grant Opportunity Finder/);
  assert.equal((document.body.textContent ?? "").includes("Founder funding view"), false);

  const started = Date.now();
  while (!(document.body.textContent ?? "").includes("Permission required. Founder Mode required")) {
    if (Date.now() - started > 4000) {
      assert.fail(`finder permission state missing: ${(document.body.textContent ?? "").slice(0, 500)}`);
    }
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  } finally {
    await React.act(async () => {
      reactRoot.unmount();
    });
    client.clear();
    close();
  }
});
