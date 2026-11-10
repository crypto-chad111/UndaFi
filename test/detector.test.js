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
  const d = new Detector({ sensitivity: 6 });
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
