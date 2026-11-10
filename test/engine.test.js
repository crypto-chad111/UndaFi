'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/store');
const { Engine } = require('../src/engine');

function setup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undafi-test-'));
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

test('a layout drawn in the demo is carried over to the real app, once', () => {
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undafi-demo-'));
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undafi-real-'));
  const demo = createStore(demoDir);
  demo.setPlan({ width: 30, height: 20, rooms: [{ id: 'k', name: 'Kitchen', x: 2, y: 2, w: 4.25, h: 0.5 }], router: { x: 1, y: 1 }, pc: { x: 9, y: 9 } });
  const real = createStore(realDir, { importPlanFrom: demoDir });
  assert.strictEqual(real.config.plan.example, false);
  assert.strictEqual(real.config.plan.width, 30);
  assert.deepStrictEqual(real.config.plan.rooms[0], { id: 'k', name: 'Kitchen', x: 2, y: 2, w: 4.25, h: 0.5 });
  // Once the real app has its own layout, the demo never overwrites it.
  real.setPlan({ rooms: [{ id: 'o', name: 'Office', x: 0, y: 0, w: 3, h: 3 }] });
  demo.setPlan({ rooms: [] });
  assert.strictEqual(createStore(realDir, { importPlanFrom: demoDir }).config.plan.rooms[0].name, 'Office');
});

test('the new timing settings are saved and kept in range', () => {
  const { store, engine } = setup({ confirmSec: 3, quietSec: 500 });
  assert.strictEqual(store.config.confirmSec, 3);
  assert.strictEqual(store.config.quietSec, 60);
  engine.settingsChanged();
  assert.strictEqual(engine.detector.confirmMs, 3000);
  assert.strictEqual(engine.snapshot().settings.quietSec, 60);
});

test('the keep-busy trickle runs only while monitoring, follows its setting, and never in the demo', () => {
  const make = (demo, settings) => {
    const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'undafi-probe-')));
    store.updateSettings({ armDelaySec: 0, ...settings });
    const calls = [];
    const engine = new Engine({
      store,
      demo,
      sendAlert: async () => ({}),
      createSensor: () => ({ start() {}, stop() {} }),
      createProbe: () => ({ start: () => calls.push('start'), stop: () => calls.push('stop') }),
    });
    return { engine, store, calls };
  };
  const a = make(false, {});
  assert.deepStrictEqual(a.calls, []);
  a.engine.setMode('test');
  assert.deepStrictEqual(a.calls, ['start']);
  a.store.updateSettings({ keepBusy: false });
  a.engine.settingsChanged();
  assert.deepStrictEqual(a.calls, ['start', 'stop']);
  a.engine.setMode('off');

  const b = make(false, { keepBusy: false });
  b.engine.setMode('armed');
  assert.ok(!b.calls.includes('start'));
  b.engine.setMode('off');

  const c = make(true, {});
  c.engine.setMode('test');
  assert.deepStrictEqual(c.calls, []);
  c.engine.setMode('off');
});

test('the log records whether signal or link speed noticed the movement', async () => {
  const { engine, store, play } = setup();
  engine.setMode('test');
  play(60, false);
  play(10, true);
  assert.strictEqual(store.events[0].trigger, 'signal');
});

const { judgeWalkTest } = require('../src/engine');

test('walk test: clear difference -> good, and the settings are applied', () => {
  const { engine, store, play } = setup({ sensitivity: 3 });
  engine.startWalkTest();
  assert.strictEqual(engine.mode, 'test', 'starts watching by itself, without alerts');
  assert.strictEqual(engine.snapshot().walkTest.phase, 'still');
  play(61, false);
  assert.strictEqual(engine.snapshot().walkTest.phase, 'walk');
  play(41, true);
  const w = engine.snapshot().walkTest;
  assert.strictEqual(w.phase, 'done');
  assert.strictEqual(w.result.verdict, 'good');
  assert.ok(w.result.walking > w.result.still * 1.6);
  assert.strictEqual(store.config.sensitivity, w.result.sensitivity);
  assert.ok(w.result.alarmAt > w.result.still && w.result.alarmAt < w.result.walking, 'alarm level sits between sitting and walking');
});

test('walk test: no difference -> says so and changes nothing', () => {
  const { engine, store, play } = setup({ sensitivity: 4 });
  engine.startWalkTest();
  play(61, false);
  play(41, false);
  const w = engine.snapshot().walkTest;
  assert.strictEqual(w.result.verdict, 'none');
  assert.strictEqual(store.config.sensitivity, 4);
});

test('walk test: refuses while monitoring is on, and can be stopped', () => {
  const { engine } = setup({ armDelaySec: 0 });
  engine.setMode('armed');
  assert.throws(() => engine.startWalkTest(), /Switch monitoring off/);
  engine.setMode('off');
  engine.startWalkTest();
  engine.cancelWalkTest();
  assert.strictEqual(engine.snapshot().walkTest, null);
});

test('walk test maths: link speed is dropped when it only adds noise', () => {
  const still = Array.from({ length: 100 }, (_, i) => ({ signal: 1, both: i % 3 ? 1 : 3 }));
  const walk = Array.from({ length: 100 }, () => ({ signal: 5, both: 5 }));
  const r = judgeWalkTest(still, walk);
  assert.strictEqual(r.useSpeed, false);
  assert.strictEqual(r.verdict, 'good');
  // ...and kept when it is the only thing that reacts (a frozen signal reading)
  const still2 = Array.from({ length: 100 }, () => ({ signal: 0, both: 1.2 }));
  const walk2 = Array.from({ length: 100 }, () => ({ signal: 0, both: 4 }));
  const r2 = judgeWalkTest(still2, walk2);
  assert.strictEqual(r2.useSpeed, true);
  assert.strictEqual(r2.verdict, 'good');
  // a faint difference is called weak, not good
  const walk3 = Array.from({ length: 100 }, () => ({ signal: 0, both: 2.1 }));
  assert.strictEqual(judgeWalkTest(still2.map(() => ({ signal: 0, both: 1.5 })), walk3).verdict, 'weak');
});

test('walk test maths: movement during the sitting-still step asks for a retry', () => {
  const still = Array.from({ length: 100 }, (_, i) => ({ signal: i > 60 ? 9 : 1, both: i > 60 ? 9 : 1 }));
  const walk = Array.from({ length: 100 }, () => ({ signal: 4, both: 4 }));
  const r = judgeWalkTest(still, walk);
  assert.strictEqual(r.verdict, 'disturbed');
  assert.strictEqual(r.sensitivity, null);
});
