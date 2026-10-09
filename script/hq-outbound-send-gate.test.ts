import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Request, Response } from "express";

process.env.NODE_ENV = "test";
delete process.env.MICROSOFT_GRAPH_TENANT_ID;
delete process.env.MICROSOFT_GRAPH_CLIENT_ID;
delete process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
delete process.env.INBOUND_MAILBOX_ADDRESS;
delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;

const { outboundSendGateHttp } = await import("../server/hq/inboundOutboundMail.ts");

function mockRes() {
  const state: { code?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      state.code = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      if (state.code == null) state.code = 200;
      state.body = body;
    },
  };
  return { state, res: res as unknown as Response };
}

function call(role?: string) {
  const { state, res } = mockRes();
  const req = { hqUser: role ? { role } : undefined } as Request;
  outboundSendGateHttp(req, res);
  return state;
}

function withFlag(value: string | undefined, role: string) {
  const previous = process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
  if (value === undefined) delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
  else process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED = value;
  try {
    return call(role);
  } finally {
    if (previous === undefined) delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
    else process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED = previous;
  }
}

test("outbound send gate reports only the exact true comparison", () => {
  for (const role of ["founder", "owner"]) {
    const absent = withFlag(undefined, role);
    const off = withFlag("false", role);
    const other = withFlag("TRUE", role);
    const on = withFlag("true", role);
    assert.equal(absent.code, 200);
    assert.deepEqual(absent.body, { outboundMailSendEnabled: false });
    assert.equal(off.code, 200);
    assert.deepEqual(off.body, { outboundMailSendEnabled: false });
    assert.deepEqual(other.body, { outboundMailSendEnabled: false });
    assert.equal(on.code, 200);
    assert.deepEqual(on.body, { outboundMailSendEnabled: true });
    assert.deepEqual(Object.keys(on.body || {}), ["outboundMailSendEnabled"]);
  }
});

test("outbound send gate denies missing and non-founder sessions", () => {
  const missing = call();
  const executive = call("EXEC");
  assert.equal(missing.code, 401);
  assert.equal(missing.body?.error, "Authentication required");
  assert.equal(executive.code, 403);
  assert.equal(executive.body?.error, "Founder session required");
  assert.equal(executive.body?.outboundMailSendEnabled, undefined);
});

test("outbound send gate route does not send mail", () => {
  const route = readFileSync(new URL("../server/routes/communications.routes.ts", import.meta.url), "utf8");
  const source = readFileSync(new URL("../server/hq/inboundOutboundMail.ts", import.meta.url), "utf8");
  assert.match(route, /router\.get\("\/outbound-send-enabled"/);
  const start = source.indexOf("export function outboundSendGateHttp");
  const handler = source.slice(start, source.indexOf("export function replySubject", start));
  assert.equal(handler.includes("sendMail"), false);
  assert.equal(handler.includes("fetch("), false);
});
