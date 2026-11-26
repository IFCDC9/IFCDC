import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_CONTROL_SURFACE_FRESH_MS,
  mapAuraMusicLaneStatus,
  resolveAbletonLive,
} from "../server/hq/auraMusicStatusMap";

test("bridge online is not Ableton Live connected", () => {
  const lane = mapAuraMusicLaneStatus({
    musicIntelligence: "ONLINE",
    abletonBridge: "ONLINE",
    abletonLive: "DISCONNECTED",
    productionNodeReported: "ONLINE",
    watchdog: "HEALTHY",
    nodeLinked: true,
    liveRunning: false,
    fileQueueConnectedHint: false,
  });
  assert.equal(lane.abletonBridge, "ONLINE");
  assert.equal(lane.abletonLive, "DISCONNECTED");
  assert.notEqual(lane.abletonLive, lane.abletonBridge);
  assert.equal(lane.productionNode, "NOT READY");
  assert.equal(lane.auraMusicReady, false);
  assert.equal(lane.nodeLinked, true);
  assert.ok(lane.alerts.some((a) => a.code === "live_disconnected"));
});

test("node linked is not production ready", () => {
  const lane = mapAuraMusicLaneStatus({
    musicIntelligence: "ONLINE",
    abletonBridge: "ONLINE",
    abletonLive: "DISCONNECTED",
    watchdog: "HEALTHY",
    nodeLinked: true,
  });
  assert.equal(lane.nodeLinked, true);
  assert.equal(lane.auraMusicReady, false);
  assert.equal(lane.productionNode, "NOT READY");
  assert.ok(lane.alerts.some((a) => a.code === "production_not_ready"));
});

test("production ready only after live control-surface check", () => {
  const notReady = mapAuraMusicLaneStatus({
    musicIntelligence: "ONLINE",
    abletonBridge: "ONLINE",
    abletonLive: "UNKNOWN",
    watchdog: "HEALTHY",
    nodeLinked: true,
    fileQueueConnectedHint: false,
  });
  assert.equal(notReady.auraMusicReady, false);

  const ready = mapAuraMusicLaneStatus({
    musicIntelligence: "ONLINE",
    abletonBridge: "ONLINE",
    abletonLive: "CONNECTED",
    watchdog: "HEALTHY",
    nodeLinked: true,
    liveRunning: true,
    liveHeartbeatAgeMs: 1_000,
    fileQueueConnectedHint: true,
  });
  assert.equal(ready.abletonLive, "CONNECTED");
  assert.equal(ready.productionNode, "READY");
  assert.equal(ready.auraMusicReady, true);
  assert.equal(ready.alerts.length, 0);
});

test("stale control-surface heartbeat is not Live connected", () => {
  const live = resolveAbletonLive({
    abletonLive: "CONNECTED",
    liveRunning: true,
    liveHeartbeatAgeMs: LIVE_CONTROL_SURFACE_FRESH_MS + 5_000,
    fileQueueConnectedHint: true,
  });
  assert.equal(live.connected, false);
  assert.equal(live.state, "DISCONNECTED");
});

test("reported production ONLINE does not imply Live or READY", () => {
  const lane = mapAuraMusicLaneStatus({
    musicIntelligence: "ONLINE",
    abletonBridge: "ONLINE",
    abletonLive: "DISCONNECTED",
    productionNodeReported: "ONLINE",
    watchdog: "HEALTHY",
    nodeLinked: true,
  });
  assert.equal(lane.productionNode, "NOT READY");
  assert.equal(lane.abletonLive, "DISCONNECTED");
});

test("file-queue hint does not override Live process stopped", () => {
  const live = resolveAbletonLive({
    abletonLive: "CONNECTED",
    liveRunning: false,
    liveHeartbeatAgeMs: 500,
    fileQueueConnectedHint: true,
  });
  assert.equal(live.connected, false);
});
