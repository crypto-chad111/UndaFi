'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Detector, thresholdFor } = require('../src/detector');

// A repeatable "random" so the tests never flake.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Feeds a signal at 2.5 samples a second; returns every start/end seen.
function feed(detector, from, seconds, signalAt) {
  const seen = { started: [], ended: [], last: null };
  for (let t = from; t < from + seconds * 1000; t += 400) {
    const r = detector.push(t, Math.round(signalAt(t)));
    if (r.started) seen.started.push(r.started);
    if (r.ended) seen.ended.push(r.ended);
    seen.last = r;
  }
  return seen;
}

test('a still house never triggers', () => {
  const rand = rng(1);
  const d = new Detector({ sensitivity: 6 });
  const seen = feed(d, 0, 600, () => -52 + (rand() - 0.5) * 2);
  assert.strictEqual(seen.started.length, 0);
  assert.strictEqual(seen.last.ready, true);
});

test('a person walking through the signal is detected, then it ends', () => {
  const rand = rng(2);
  const d = new Detector({ sensitivity: 6 });
  const quiet = () => -52 + (rand() - 0.5) * 2;
  feed(d, 0, 60, quiet);
  const walk = feed(d, 60000, 10, (t) => -52 + Math.sin(t / 420) * 6);
  assert.strictEqual(walk.started.length, 1);
  assert.ok(walk.started[0].start - 60000 < 5000, 'noticed within 5 seconds');
  const after = feed(d, 70000, 40, quiet);
  assert.strictEqual(after.ended.length, 1);
  assert.strictEqual(after.ended[0].size, 'large');
  assert.strictEqual(after.started.length, 0, 'no second alarm from the same walk');
});

test('a weaker disturbance is reported as small', () => {
  const rand = rng(3);
  const d = new Detector({ sensitivity: 8 });
  const quiet = () => -52 + (rand() - 0.5) * 2;
  feed(d, 0, 60, quiet);
  const seen = feed(d, 60000, 10, (t) => -52 + Math.sin(t / 420) * 3);
  const after = feed(d, 70000, 40, quiet);
  assert.strictEqual(seen.started.length, 1);
  assert.strictEqual(after.ended[0].size, 'small');
});

test('nothing is judged during the first 15 seconds', () => {
  const d = new Detector();
  const seen = feed(d, 0, 12, (t) => -52 + Math.sin(t / 420) * 8);
  assert.strictEqual(seen.started.length, 0);
  assert.strictEqual(seen.last.ready, false);
});

test('a furniture-style permanent change stops alarming by itself', () => {
  const rand = rng(4);
  const d = new Detector({ sensitivity: 6 });
  feed(d, 0, 60, () => -52 + (rand() - 0.5) * 2);
  const seen = feed(d, 60000, 240, () => -60 + (rand() - 0.5) * 2);
  assert.strictEqual(seen.started.length, 1);
  assert.strictEqual(seen.ended.length, 1);
  assert.strictEqual(seen.last.motion, null);
});

test('lower sensitivity needs a bigger disturbance', () => {
  assert.ok(thresholdFor(1) > thresholdFor(10));
  const rand = rng(5);
  const d = new Detector({ sensitivity: 1 });
  const quiet = () => -52 + (rand() - 0.5) * 2;
  feed(d, 0, 60, quiet);
  const seen = feed(d, 60000, 10, (t) => -52 + Math.sin(t / 420) * 2.2);
  assert.strictEqual(seen.started.length, 0);
});

test('a sensor drop-out starts learning again instead of alarming', () => {
  const rand = rng(6);
  const d = new Detector();
  feed(d, 0, 60, () => -52 + (rand() - 0.5) * 2);
  const r = d.push(200000, -70);
  assert.strictEqual(r.ready, false);
  assert.strictEqual(r.started, null);
});

test('at maximum sensitivity a still house stays quiet and movement still ends', () => {
  const rand = rng(8);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const quiet = () => -52 + gauss() * 0.45;
  const d = new Detector({ sensitivity: 10 });
  const still = feed(d, 0, 3600, quiet);
  assert.strictEqual(still.started.length, 0, 'no false alarm in an hour of stillness');
  const walk = feed(d, 3600000, 10, (t) => -52 + Math.sin(t / 420) * 6);
  assert.strictEqual(walk.started.length, 1);
  const after = feed(d, 3610000, 30, quiet);
  assert.strictEqual(after.ended.length, 1, 'the movement is over within 30 seconds, not stuck on');
  assert.strictEqual(after.last.motion, null);
});

test('one glitchy reading is not movement', () => {
  const rand = rng(9);
  const d = new Detector({ sensitivity: 10 });
  const quiet = () => -52 + (rand() - 0.5) * 2;
  feed(d, 0, 60, quiet);
  const r = d.push(60000, -75);
  assert.strictEqual(r.started, null);
  const after = feed(d, 60400, 30, quiet);
  assert.strictEqual(after.started.length, 0);
});

test('"must last" ignores a blip shorter than the setting', () => {
  const rand = rng(10);
  const quiet = () => -52 + (rand() - 0.5) * 2;
  const run = (confirmMs) => {
    const d = new Detector({ sensitivity: 7, confirmMs });
    feed(d, 0, 60, quiet);
    const blip = feed(d, 60000, 4, (t) => -52 + Math.sin(t / 420) * 6);
    const rest = feed(d, 64000, 30, quiet);
    return blip.started.length + rest.started.length;
  };
  assert.strictEqual(run(0), 1);
  assert.strictEqual(run(15000), 0);
});
