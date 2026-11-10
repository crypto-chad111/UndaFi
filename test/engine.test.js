'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/store');
const { Engine } = require('../src/engine');

function setup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
  const store = createStore(dir);
  store.updateSettings({ ntfy: { enabled: true, topic: 'abc' }, ...settings });
  const clock = { t: 1000000 };
  const sent = [];
  let handlers;
  const engine = new Engine({
    store,
    now: () => clock.t,
    sendAlert: async (config, alert) => {
      sent.push(alert);
      return { ntfy: 'sent' };
    },
    createSensor: (h) => {
      handlers = h;
      return { start() {}, stop() {} };
    },
  });
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  // Plays a number of seconds of signal into the engine.
  function play(seconds, moving) {
    for (let i = 0; i < seconds * 2.5; i += 1) {
      clock.t += 400;
      const dbm = moving ? -52 + Math.sin(clock.t / 420) * 6 : -52 + (rand() - 0.5) * 2;
      handlers.onStatus({ status: 'ok' });
      handlers.onSample({ t: clock.t, dbm: Math.round(dbm) });
      engine.tick();
    }
  }
  const settle = () => new Promise((r) => setImmediate(r));
  return { engine, store, sent, play, settle, clock, dir, handlers: () => handlers };
}

test('switching on counts down, then movement sends one alert', async () => {
  const { engine, store, sent, play, settle } = setup();
  engine.setMode('armed');
  assert.strictEqual(engine.mode, 'arming');
  play(30, true); // the owner walking out: must not alert
  assert.strictEqual(sent.length, 0);
  play(60, false);
  assert.strictEqual(engine.mode, 'armed');
  play(60, false);
  play(10, true);
  await settle();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].title, /Movement detected/);
  assert.match(sent[0].body, /Living room/);
  const last = store.events[store.events.length - 1];
  assert.strictEqual(last.armed, true);
  assert.deepStrictEqual(last.alert, { ntfy: 'sent' });
});

test('a second movement right after does not send a second alert', async () => {
  const { engine, sent, play, settle, store } = setup({ armDelaySec: 0, alertCooldownSec: 300 });
  engine.setMode('armed');
  assert.strictEqual(engine.mode, 'armed');
  play(60, false);
  play(8, true);
  play(30, false);
  play(8, true);
  play(30, false);
  await settle();
  assert.strictEqual(sent.length, 1);
  assert.ok(store.events.length >= 2, 'both movements are still in the log');
});

test('test mode draws movement but never alerts', async () => {
  const { engine, sent, play, settle, store } = setup();
  engine.setMode('test');
  play(60, false);
  play(10, true);
  await settle();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(store.events.length, 1);
  assert.strictEqual(store.events[0].armed, false);
  assert.ok(engine.snapshot().motion);
});

test('off really stops: later samples are ignored', () => {
  const { engine, play, store } = setup();
  engine.setMode('test');
  play(60, false);
  engine.setMode('off');
  play(10, true);
  assert.strictEqual(store.events.length, 0);
  assert.strictEqual(engine.snapshot().motion, null);
});

test('warns when armed but the WiFi signal cannot be read', async () => {
  const { engine, sent, clock, settle, handlers } = setup({ armDelaySec: 0 });
  engine.setMode('armed');
  handlers().onStatus({ status: 'no-wifi', detail: 'This PC is not connected to WiFi.' });
  clock.t += 61000;
  engine.tick();
  engine.tick();
  await settle();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].title, /cannot see the WiFi signal/);
});

test('the email password is saved but never shown to the dashboard', () => {
  const { engine, store, dir } = setup({ email: { enabled: true, host: 'smtp.example.com', user: 'me', pass: 'hunter2-secret', to: 'a@b.c' } });
  assert.strictEqual(store.config.email.pass, 'hunter2-secret');
  const snap = JSON.stringify(engine.snapshot({ withHistory: true }));
  assert.ok(!snap.includes('hunter2-secret'));
  assert.strictEqual(engine.snapshot().settings.email.passSet, true);
  // Saving other settings must not wipe the password, and it survives a restart.
  store.updateSettings({ email: { host: 'smtp2.example.com', pass: '' } });
  assert.strictEqual(createStore(dir).config.email.pass, 'hunter2-secret');
});

test('the on/off choice survives a restart', () => {
  const { engine, dir } = setup();
  engine.setMode('armed');
  assert.strictEqual(createStore(dir).config.mode, 'armed');
  engine.setMode('off');
  assert.strictEqual(createStore(dir).config.mode, 'off');
});
