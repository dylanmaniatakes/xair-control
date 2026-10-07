const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
function harness() {
  const ctx = vm.createContext({
    status: { mode: 'demo', model: 'XR12', ip: '127.0.0.1', port: 10024 },
    values: { 'strip.0.send.0.level': -18, 'strip.0.send.1.level': -6, 'strip.0.mix.fader': -3, 'strip.0.mute': false },
    paint() {}, writes: [],
  });
  ctx.send = async (path, operation, value) => { ctx.writes.push({path, operation, value}); ctx.values[path] = value; };
  vm.runInContext(readFileSync('app/static/routing.js', 'utf8'), ctx);
  return ctx;
}
test('send mute and restore affect only the selected destination', async () => {
  const c = harness(), p = 'strip.0.send.0.level';
  await c.toggleSendLevel(p);
  assert.equal(c.values[p], -90);
  assert.equal(c.values['strip.0.send.1.level'], -6);
  assert.equal(c.values['strip.0.mix.fader'], -3);
  assert.equal(c.values['strip.0.mute'], false);
  await c.toggleSendLevel(p);
  assert.equal(c.values[p], -18);
});
test('unknown or already-off sends never jump to an arbitrary level', async () => {
  const c = harness(), p = 'strip.0.send.0.level';
  c.values[p] = -90;
  await c.toggleSendLevel(p);
  await c.toggleSendLevel('unknown');
  assert.equal(c.writes.length, 0);
});
test('restore level is isolated by mixer connection', async () => {
  const c = harness(), p = 'strip.0.send.0.level';
  await c.toggleSendLevel(p);
  c.status.port = 10025;
  await c.toggleSendLevel(p);
  assert.equal(c.writes.length, 1);
  assert.equal(c.values[p], -90);
});
test('duplicate mute clicks are ignored while a command is pending', async () => {
  const c = harness(), p = 'strip.0.send.0.level';
  let finish, calls = 0;
  c.send = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = c.toggleSendLevel(p);
  await c.toggleSendLevel(p);
  assert.equal(calls, 1);
  finish();
  await first;
});
