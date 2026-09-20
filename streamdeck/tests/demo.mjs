// Optional integration test. Refuses to change anything unless the server is in demo mode.
import assert from "node:assert/strict";
import {
  configuration,
  request,
  readState,
  adjust,
  toggle,
  channels,
} from "../src/client.js";
const config = configuration({
  server: process.argv[2] || "http://127.0.0.1:18091",
});
assert.equal(
  (await request(config.server, "/api/status")).mode,
  "demo",
  "This test only supports demo servers",
);
const before = await readState(config);
try {
  const result = await channels(config.server);
  assert.ok(result.channels.some((c) => c.root === "strip.0"));
  await request(config.server, "/api/command", {
    path: "strip.0.mix.fader",
    value: -12,
  });
  await adjust(config, 2);
  assert.equal((await readState(config)).level, -10);
  await adjust(config, -0.3);
  assert.equal((await readState(config)).level, -10.3);
  await toggle(config);
  assert.equal((await readState(config)).mute, !before.mute);
  console.log(
    "PASS: real X AIR demo API discovery, relative/fine faders, mute and readback",
  );
} finally {
  await request(config.server, "/api/command", {
    path: "strip.0.mix.fader",
    value: before.level,
  });
  await request(config.server, "/api/command", {
    path: "strip.0.mute",
    value: before.mute,
  });
}
