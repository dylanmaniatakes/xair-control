import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('inspector routes discovery and settings with its own UUID, distinct from action context', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, reportValidity: () => true,
      replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; },
    });
    return elements.get(id);
  };
  const sent = [];
  let socket;
  class WebSocket {
    static OPEN = 1;
    readyState = 1;
    constructor() { socket = this; }
    send(raw) { sent.push(JSON.parse(raw)); }
  }
  const window = {};
  runInNewContext(readFileSync(new URL('../com.dylanmaniatakes.xair-control.sdPlugin/ui/inspector.js', import.meta.url), 'utf8'), {
    window, document: { getElementById: element }, WebSocket,
    Option: class { constructor(label, value) { this.label = label; this.value = value; } },
    setTimeout: () => {},
  });
  const action = 'com.dylanmaniatakes.xair-control.fader';
  window.connectElgatoStreamDeckSocket('12345', 'inspector-id', 'registerPropertyInspector', '{}', JSON.stringify({
    context: 'different-action-id', action, payload: { settings: { server: 'https://mixer.example.com' } },
  }));
  socket.onopen();
  assert.deepEqual(sent[0], { event: 'registerPropertyInspector', uuid: 'inspector-id' });
  assert.equal(sent[1].context, 'inspector-id');
  assert.equal(sent[1].action, action);
  socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: {
    requestId: sent[1].payload.requestId, mode: 'live', channels: [{ root: 'strip.0', label: 'Input 1' }],
  } }) });
  element('settings').onsubmit({ preventDefault() {} });
  assert.equal(sent[2].event, 'setSettings');
  assert.equal(sent[2].context, 'inspector-id');
  assert.equal(sent[2].action, action);
  assert.equal(sent[2].payload.root, 'strip.0');
});
