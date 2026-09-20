import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import {
  configuration,
  adjust,
  readState,
  channels,
  feedback,
  request,
} from "../src/client.js";
import { Controller } from "../src/controller.js";

const snapshot = (level = -12, mute = false) => ({
  values: {
    "strip.0.mix.fader": level,
    "strip.0.mute": mute,
    "strip.0.config.name": "Microphone",
  },
  errors: {},
});
const ok = (data) => ({ ok: true, json: async () => data });
const config = configuration({
  server: "http://127.0.0.1:8088",
  root: "strip.0",
});
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timed out waiting for test event");
}

async function fixture(t) {
  const wire = { level: -12, mute: false, writes: [], reads: 0 };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/status")
      return res.end(JSON.stringify({ mode: "demo" }));
    if (req.url === "/api/catalog")
      return res.end(
        JSON.stringify([
          { path: "strip.0.mix.fader" },
          { path: "strip.0.mute" },
        ]),
      );
    if (req.url === "/api/read") {
      wire.reads++;
      return res.end(JSON.stringify(snapshot(wire.level, wire.mute)));
    }
    if (req.url === "/api/command") {
      wire.writes.push(body);
      if (body.operation === "increment") wire.level += body.value;
      else if (body.operation === "toggle") wire.mute = !wire.mute;
      else assert.fail("Unexpected operation");
      return res.end(
        JSON.stringify({
          value: body.operation === "toggle" ? wire.mute : wire.level,
        }),
      );
    }
    res.writeHead(404);
    res.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    ...wire,
    get level() {
      return wire.level;
    },
    get mute() {
      return wire.mute;
    },
    wire,
    server: `http://127.0.0.1:${server.address().port}`,
  };
}
function control(t, settings) {
  const messages = [];
  const c = new Controller((m) => messages.push(m), {
    pollMs: 100000,
    batchMs: 10,
  });
  t.after(() => c.close());
  c.handle({ event: "willAppear", context: "dial", payload: { settings } });
  return { c, messages };
}

test("settings reject invalid targets, credentials, and out-of-range steps", () => {
  for (const settings of [
    { server: "file:///tmp/foo" },
    { server: "http://u:p@localhost" },
    { server: "http://localhost?token=x" },
    { server: "http://localhost", root: "config.amixenable" },
    { server: "http://localhost", step: 0 },
  ])
    assert.throws(() => configuration(settings));
  assert.equal(
    configuration({ server: "http://localhost/proxy/" }).server,
    "http://localhost/proxy",
  );
});
test("read state requires real fader and mute values", async () => {
  await assert.rejects(
    readState(config, async () => ok({ values: {}, errors: {} })),
    /unavailable/,
  );
});
test("increment clamps to both endpoints and does not write at an endpoint", async () => {
  for (const [current, delta, expected] of [
    [9, 4, 1],
    [-89, -4, -1],
    [10, 1, 0],
    [-90, -1, 0],
  ]) {
    const writes = [];
    await adjust(config, delta, async (url, options) => {
      if (url.endsWith("/api/read")) return ok(snapshot(current));
      writes.push(JSON.parse(options.body));
      return ok({});
    });
    assert.equal(writes.length, expected ? 1 : 0);
    if (expected)
      assert.deepEqual(writes[0], {
        path: "strip.0.mix.fader",
        operation: "increment",
        value: expected,
      });
  }
});
test("uncertain command is never automatically retried", async () => {
  let writes = 0;
  await assert.rejects(
    adjust(config, 1, async (url) => {
      if (url.endsWith("/api/read")) return ok(snapshot());
      writes++;
      throw Error("timeout");
    }),
    /uncertain/,
  );
  assert.equal(writes, 1);
});
test("settings invalidation after read cancels the queued adjustment", async () => {
  let writes = 0;
  await adjust(
    config,
    2,
    async (url) => {
      if (url.endsWith("/api/read")) return ok(snapshot());
      writes++;
      return ok({});
    },
    () => false,
  );
  assert.equal(writes, 0);
});
test("channel discovery is read-only and returns human names", async (t) => {
  const f = await fixture(t);
  const result = await channels(f.server);
  assert.deepEqual(result, {
    mode: "demo",
    channels: [{ root: "strip.0", label: "Input 1 · Microphone" }],
  });
  assert.equal(f.wire.writes.length, 0);
});
test("dial ticks coalesce into a relative adjustment with live feedback", async (t) => {
  const f = await fixture(t),
    { c, messages } = control(t, { server: f.server });
  await until(() => messages.some((m) => m.payload?.title === "Microphone"));
  for (const ticks of [1, 2, -1])
    c.handle({
      event: "dialRotate",
      context: "dial",
      payload: { ticks, pressed: false },
    });
  await until(() => messages.some((m) => m.payload?.value === "-10.0 dB"));
  assert.equal(f.level, -10);
  assert.equal(f.wire.writes.length, 1);
  assert.equal(f.wire.writes[0].value, 2);
});
test("hold-turn uses fine adjustment and release does not mute", async (t) => {
  const f = await fixture(t),
    { c, messages } = control(t, { server: f.server, step: 1, fine: 0.1 });
  c.handle({ event: "dialDown", context: "dial" });
  c.handle({
    event: "dialRotate",
    context: "dial",
    payload: { ticks: 3, pressed: true },
  });
  c.handle({ event: "dialUp", context: "dial" });
  await until(() => messages.some((m) => m.payload?.value === "-11.7 dB"));
  assert.equal(f.mute, false);
  assert.equal(f.wire.writes.length, 1);
  c.handle({ event: "dialDown", context: "dial" });
  c.handle({ event: "dialUp", context: "dial" });
  await until(() => f.mute);
  await until(() =>
    messages.some((m) => m.payload?.value?.startsWith("MUTED")),
  );
});
test("disappearing action discards pending rotations", async (t) => {
  const f = await fixture(t),
    { c } = control(t, { server: f.server });
  c.handle({ event: "dialRotate", context: "dial", payload: { ticks: 5 } });
  c.handle({ event: "willDisappear", context: "dial" });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(f.wire.writes.length, 0);
});
test("two dials controlling the same target serialize increments", async (t) => {
  const f = await fixture(t),
    { c, messages } = control(t, { server: f.server });
  c.handle({
    event: "willAppear",
    context: "other",
    payload: { settings: { server: f.server } },
  });
  for (const context of ["dial", "other"])
    c.handle({ event: "dialRotate", context, payload: { ticks: 2 } });
  await until(() => f.wire.writes.length === 2);
  assert.equal(f.level, -8);
  assert.ok(messages.length);
});
test("feedback preserves mute, silence and upper-end positions", () => {
  assert.equal(
    feedback({ name: "Mic", level: -90, mute: true }).value,
    "MUTED · −∞ dB",
  );
  assert.equal(
    feedback({ name: "Mic", level: 10, mute: false }).indicator,
    100,
  );
});
test("packaged runtime registers and handles real WebSocket events", async (t) => {
  const f = await fixture(t),
    ws = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(ws, "listening");
  const plugin = spawn(
    process.execPath,
    [
      "com.dylanmaniatakes.xair-control.sdPlugin/bin/plugin.cjs",
      "-port",
      String(ws.address().port),
      "-pluginUUID",
      "test-plugin",
      "-registerEvent",
      "registerPlugin",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    plugin.kill();
    for (const client of ws.clients) client.terminate();
    ws.close();
  });
  const [socket] = await once(ws, "connection"),
    messages = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw)));
  await until(() =>
    messages.some(
      (m) => m.event === "registerPlugin" && m.uuid === "test-plugin",
    ),
  );
  socket.send(
    JSON.stringify({
      event: "willAppear",
      context: "dial",
      payload: { settings: { server: f.server } },
    }),
  );
  await until(() =>
    messages.some(
      (m) => m.event === "setFeedback" && m.payload.title === "Microphone",
    ),
  );
  socket.send(
    JSON.stringify({
      event: "dialRotate",
      context: "dial",
      payload: { ticks: -2, pressed: false },
    }),
  );
  await until(() => messages.some((m) => m.payload?.value === "-14.0 dB"));
  assert.equal(f.level, -14);
  socket.send(
    JSON.stringify({
      event: "sendToPlugin",
      context: "dial",
      payload: { event: "discover", server: f.server, requestId: 7 },
    }),
  );
  await until(() =>
    messages.some(
      (m) => m.event === "sendToPropertyInspector" && m.payload.requestId === 7,
    ),
  );
});

test("retargeting drops old queued ticks instead of applying them to the new settings", async (t) => {
  const f = await fixture(t),
    { c } = control(t, { server: f.server });
  c.handle({ event: "dialRotate", context: "dial", payload: { ticks: 9 } });
  c.handle({
    event: "didReceiveSettings",
    context: "dial",
    payload: { settings: { server: f.server, step: 0.5 } },
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(f.wire.writes.length, 0);
});
test("polling follows external fader changes without issuing commands", async (t) => {
  const f = await fixture(t),
    messages = [];
  const c = new Controller((m) => messages.push(m), { pollMs: 30 });
  t.after(() => c.close());
  c.handle({
    event: "willAppear",
    context: "dial",
    payload: { settings: { server: f.server } },
  });
  await until(() => messages.some((m) => m.payload?.value === "-12.0 dB"));
  f.wire.level = -7;
  f.wire.mute = true;
  await until(() =>
    messages.some((m) => m.payload?.value === "MUTED · -7.0 dB"),
  );
  assert.equal(f.wire.writes.length, 0);
});
