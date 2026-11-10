'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/store');
const { Engine } = require('../src/engine');
const { createHandler, hostAllowed } = require('../src/http');

async function start() {
  const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-http-')));
  const engine = new Engine({ store, sendAlert: async () => ({}), createSensor: () => ({ start() {}, stop() {} }) });
  const server = http.createServer(createHandler({ engine, store, getAllowedIps: () => ['100.101.102.103'], getUrls: () => [] }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // fetch() will not let us set a fake Host header, so use http.request.
  const call = (method, route, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: route, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(body);
    });
  return { call, engine, store, port, close: () => { engine.setMode('off'); server.close(); } };
}

test('serves the dashboard and the state', async () => {
  const app = await start();
  const page = await app.call('GET', '/');
  assert.strictEqual(page.status, 200);
  assert.match(page.text, /WiFi Sentinel/);
  const state = (await app.call('GET', '/api/state')).json();
  assert.strictEqual(state.mode, 'off');
  assert.ok(Array.isArray(state.plan.rooms));
  app.close();
});

test('the on/off button works through the API', async () => {
  const app = await start();
  const json = { 'Content-Type': 'application/json' };
  const on = await app.call('POST', '/api/mode', { headers: json, body: '{"mode":"test"}' });
  assert.strictEqual(on.json().state.mode, 'test');
  const off = await app.call('POST', '/api/mode', { headers: json, body: '{"mode":"off"}' });
  assert.strictEqual(off.json().state.mode, 'off');
  const bad = await app.call('POST', '/api/mode', { headers: json, body: '{"mode":"nonsense"}' });
  assert.strictEqual(bad.status, 400);
  app.close();
});

test('other websites cannot switch monitoring off', async () => {
  const app = await start();
  app.engine.setMode('test');
  // A form on another site can only send these content types...
  const form = await app.call('POST', '/api/mode', { headers: { 'Content-Type': 'text/plain' }, body: '{"mode":"off"}' });
  assert.strictEqual(form.status, 415);
  // ...and a script on another site announces where it comes from.
  const script = await app.call('POST', '/api/mode', { headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"mode":"off"}' });
  assert.strictEqual(script.status, 403);
  // A web address that secretly points at this PC is refused outright.
  const rebind = await app.call('GET', '/api/state', { headers: { Host: 'evil.example' } });
  assert.strictEqual(rebind.status, 403);
  assert.strictEqual(app.engine.mode, 'test');
  app.close();
});

test('only this PC and Tailscale names are accepted', () => {
  const ips = ['100.101.102.103'];
  assert.ok(hostAllowed('localhost:4780', ips));
  assert.ok(hostAllowed('127.0.0.1:4780', ips));
  assert.ok(hostAllowed('100.101.102.103:4780', ips));
  assert.ok(hostAllowed('desktop.tail1234.ts.net:4780', ips));
  assert.ok(!hostAllowed('192.168.1.20:4780', ips));
  assert.ok(!hostAllowed('evil.example', ips));
  assert.ok(!hostAllowed('', ips));
});

test('cannot read files outside the dashboard folder', async () => {
  const app = await start();
  for (const route of ['/../server.js', '/..%2fserver.js', '/%2e%2e/package.json', '/src/store.js']) {
    const res = await app.call('GET', route);
    assert.strictEqual(res.status, 404, route);
  }
  app.close();
});
