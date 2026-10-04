/**
 * Integration framework cycle and route status mapping.
 * No network, no mail, no production unlock.
 * Does not boot the full HQ router or a signed Founder session.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { HQ_INHERITED_SERVICES, buildSoftwareDivisionFramework } from "../server/hq/softwareDivisionFramework.ts";
import { buildDivisionConnectorManifest, buildSoftwareDivisionConnectors } from "../server/hq/divisionConnectors.ts";
import { SOFTWARE_DIVISION_APPS } from "../server/hq/appRegistry.ts";
import { hqAuthRequired, requireHQModule } from "../server/middleware/hqAuth.ts";

function mockRes() {
  const state: { statusCode: number; body: unknown } = { statusCode: 0, body: undefined };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  };
  return { state, res: res as unknown as Response };
}

test("framework builder and connector manifest return the static contract without recursing", () => {
  const framework = buildSoftwareDivisionFramework();
  const manifest = buildDivisionConnectorManifest();
  const connectors = buildSoftwareDivisionConnectors();

  assert.equal(framework.barbersProductionLocked, true);
  assert.equal(framework.version, "2.1.0");
  assert.deepEqual(
    framework.inheritedServices.map((service) => service.id),
    HQ_INHERITED_SERVICES.map((service) => service.id),
  );
  assert.equal(framework.apps.length, SOFTWARE_DIVISION_APPS.length);
  const barbers = framework.apps.find((app) => app.appId === "barbers");
  assert.ok(barbers);
  assert.equal(barbers.locked, true);
  assert.equal(barbers.status, "locked");

  assert.equal(manifest.softwareDivision.length, SOFTWARE_DIVISION_APPS.length);
  assert.equal(manifest.headquartersRole, "unified_auth_permissions_database_reporting");
  assert.ok(manifest.economicDevelopment);
  assert.ok(manifest.caseManagement);
  assert.deepEqual(
    connectors.find((app) => app.id === "barbers")?.inheritedServices,
    HQ_INHERITED_SERVICES.map((service) => service.id),
  );
  assert.deepEqual(framework.divisionConnectors.softwareDivision, manifest.softwareDivision);
});

test("unauthenticated framework middleware stays 401 and denied roles stay 403", () => {
  const unauthenticated = mockRes();
  hqAuthRequired(
    { cookies: {}, header: () => undefined } as unknown as Request,
    unauthenticated.res,
    (() => { throw new Error("next should not run"); }) as NextFunction,
  );
  assert.equal(unauthenticated.state.statusCode, 401);
  assert.deepEqual(unauthenticated.state.body, { error: "Authentication required" });

  const missingUser = mockRes();
  let missingContinued = false;
  requireHQModule("software_division")(
    {} as Request,
    missingUser.res,
    (() => { missingContinued = true; }) as NextFunction,
  );
  assert.equal(missingContinued, false);
  assert.equal(missingUser.state.statusCode, 401);

  const denied = mockRes();
  let deniedContinued = false;
  requireHQModule("software_division")(
    { hqUser: { id: "u", email: "c@example.com", role: "client" } } as Request,
    denied.res,
    (() => { deniedContinued = true; }) as NextFunction,
  );
  assert.equal(deniedContinued, false);
  assert.equal(denied.state.statusCode, 403);
  assert.deepEqual(denied.state.body, { error: "Access denied to software_division" });

  const founder = mockRes();
  let founderContinued = false;
  requireHQModule("software_division")(
    { hqUser: { id: "founder", email: "founder@example.com", role: "founder" } } as Request,
    founder.res,
    (() => { founderContinued = true; }) as NextFunction,
  );
  assert.equal(founderContinued, true);
  assert.equal(founder.state.statusCode, 0);

  let status = 500;
  try {
    const payload = buildSoftwareDivisionFramework();
    assert.equal(payload.barbersProductionLocked, true);
    status = 200;
  } catch {
    status = 500;
  }
  assert.equal(status, 200);
});
