'use strict';

// DEMO ONLY. Makes up a WiFi signal with pretend movement every so often, so
// the dashboard can be tried without a WiFi connection. Never used unless the
// app is started with --demo, and the dashboard shows a DEMO badge throughout.

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function createDemoSensor({ intervalMs = 400, onSample, onStatus, firstBurstMs = 24000 }) {
  let timer = null;
  let burst = null;
  let nextBurstAt = 0;
  let count = 0;

  function tick() {
    const now = Date.now();
    if (!burst && now >= nextBurstAt) {
      const large = count % 3 !== 1; // every third pretend visitor is small
      count += 1;
      burst = { until: now + 6000 + Math.random() * 7000, amp: large ? 6 + Math.random() * 3 : 2.5 + Math.random() * 0.5 };
    }
    let dbm = -52 + gaussian() * 0.45;
    if (burst) {
      dbm += Math.sin(now / 420) * burst.amp + gaussian() * burst.amp * 0.35;
      if (now >= burst.until) {
        burst = null;
        nextBurstAt = now + 22000 + Math.random() * 20000;
      }
    }
    onStatus({ status: 'ok', ssid: 'Demo signal', detail: '' });
    onSample({ t: now, dbm: Math.round(dbm) });
  }

  return {
    start() {
      if (timer) return;
      burst = null;
      nextBurstAt = Date.now() + firstBurstMs;
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createDemoSensor };
