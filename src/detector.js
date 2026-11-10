'use strict';

// Motion detector for one WiFi link.
//
// It is fed readings from the WiFi card a few times a second: the signal
// strength (dBm) and, when the card reports them, the link speeds. A person
// or animal moving through the path between the two radios disturbs these.
// The detector compares how disturbed each reading is right now with how it
// normally behaves when the house is still.
//
// Some WiFi cards report a lively signal that wobbles. Others report a flat
// line that only jumps in steps. Both are handled: "wobble" catches the
// first kind, "shift" (the level moved away from where it normally sits)
// catches the second.

const WINDOW_MS = 6000; // "right now" = the last 6 seconds
const MEAN_MS = 30000; // normal level = median of the last half minute
const HISTORY_MS = 300000; // normal wobble = learned from the last 5 minutes
const WARMUP_MS = 15000; // listen this long before judging anything
const GAP_RESET_MS = 10000; // a silence this long means the sensor dropped out

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Sensitivity 1 (least) to 10 (most) -> how many times the normal
// disturbance counts as movement. A perfectly still house already scores
// about 1, with peaks up to 2, so the most sensitive setting must stay above
// that or it would alarm on nothing.
function thresholdFor(sensitivity) {
  const s = clamp(Number(sensitivity) || 7, 1, 10);
  return Math.round((5.1 - (s - 1) * 0.29) * 100) / 100;
}

// Movement counts as over once the level drops back near the still-house level.
function endLevelFor(threshold) {
  return Math.max(threshold * 0.65, 1.7);
}

function mean(values) {
  let sum = 0;
  for (const v of values) sum += v;
  return values.length ? sum / values.length : 0;
}

function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sq = 0;
  for (const v of values) sq += (v - m) * (v - m);
  return Math.sqrt(sq / values.length);
}

// Drops the single highest and lowest reading, so one glitchy reading from
// the WiFi card cannot look like movement.
function trimmed(values) {
  if (values.length < 8) return values;
  return [...values].sort((a, b) => a - b).slice(1, -1);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

// Follows one kind of reading and scores how disturbed it is right now.
class Tracker {
  constructor(floor) {
    this.floor = floor; // the smallest "normal wobble" we believe in
    this.reset();
  }

  reset() {
    this.samples = []; // { t, v } for the last minute
    this.stdHistory = []; // { t, std } one per second for the last 5 minutes
    this.baseStd = this.floor;
    this.level = 0;
  }

  push(t, v) {
    this.samples.push({ t, v });
    while (this.samples.length && this.samples[0].t < t - MEAN_MS) this.samples.shift();

    const recent = [];
    const older = [];
    for (const s of this.samples) (s.t > t - WINDOW_MS ? recent : older).push(s.v);
    const steady = trimmed(recent);
    const shortStd = std(steady);
    const shortMean = mean(steady);

    const lastStd = this.stdHistory[this.stdHistory.length - 1];
    if (recent.length >= 5 && (!lastStd || t - lastStd.t >= 1000)) {
      this.stdHistory.push({ t, std: shortStd });
      while (this.stdHistory.length && this.stdHistory[0].t < t - HISTORY_MS) this.stdHistory.shift();
    }

    // The quietest quarter of recent history is "the house when still". This
    // stays correct even if someone was moving for part of that time.
    this.baseStd = Math.max(this.floor, percentile(this.stdHistory.map((h) => h.std), 0.25));
    const baseMean = percentile(older.length >= 5 ? older : this.samples.map((s) => s.v), 0.5);

    const wobble = shortStd / this.baseStd;
    const shift = Math.abs(shortMean - baseMean) / (2 * this.baseStd);
    this.level = recent.length >= 5 ? Math.max(wobble, shift) : 0;
    return this.level;
  }
}

// Link speed in Mbps -> a scale where one step of the WiFi card's speed
// ladder is roughly 1, like 1 dB of signal.
function speedScale(mbps) {
  return 20 * Math.log10(Math.max(1, mbps));
}

class Detector {
  constructor(options = {}) {
    this.sensitivity = options.sensitivity || 7;
    this.confirmMs = 1000; // movement must last this long before it counts
    this.quietMs = 5000; // movement ends after this much quiet
    this.useSpeed = true; // also watch the link speeds
    this.trackers = { signal: new Tracker(0.4), down: new Tracker(0.6), up: new Tracker(0.6) };
    this.configure(options);
    this.reset();
  }

  reset() {
    for (const tracker of Object.values(this.trackers)) tracker.reset();
    this.firstAt = null;
    this.lastAt = null;
    this.above = 0;
    this.aboveSince = null;
    this.quietSince = null;
    this.motion = null; // { start, peak, trigger } while movement is in progress
    this.level = 0;
  }

  configure({ sensitivity, confirmMs, quietMs, useSpeed } = {}) {
    if (sensitivity !== undefined) this.sensitivity = sensitivity;
    if (Number.isFinite(confirmMs)) this.confirmMs = confirmMs;
    if (Number.isFinite(quietMs)) this.quietMs = quietMs;
    if (typeof useSpeed === 'boolean') this.useSpeed = useSpeed;
  }

  get threshold() {
    return thresholdFor(this.sensitivity);
  }

  get ready() {
    return this.firstAt !== null && this.lastAt - this.firstAt >= WARMUP_MS;
  }

  sizeFor(peak) {
    return peak >= this.threshold * 2.2 ? 'large' : 'small';
  }

  // reading: a signal strength in dBm, or { dbm, rx, tx } with link speeds.
  // Returns { ready, level, threshold, motion, started?, ended? }.
  push(t, reading) {
    const r = typeof reading === 'number' ? { dbm: reading } : reading;
    let ended = null;
    if (this.lastAt !== null && t - this.lastAt > GAP_RESET_MS) {
      if (this.motion) ended = this.finish(this.lastAt);
      this.reset();
    }
    if (this.firstAt === null) this.firstAt = t;
    this.lastAt = t;

    const levels = { signal: this.trackers.signal.push(t, r.dbm) };
    if (Number.isFinite(r.rx) && r.rx > 0) levels.down = this.trackers.down.push(t, speedScale(r.rx));
    if (Number.isFinite(r.tx) && r.tx > 0) levels.up = this.trackers.up.push(t, speedScale(r.tx));

    let trigger = 'signal';
    let level = levels.signal;
    if (this.useSpeed) {
      const speed = Math.max(levels.down || 0, levels.up || 0);
      if (speed > level) {
        level = speed;
        trigger = 'speed';
      }
    }
    this.level = this.ready ? level : 0;

    const threshold = this.threshold;
    let started = null;
    if (this.ready) {
      if (this.level >= threshold) {
        this.above += 1;
        if (this.aboveSince === null) this.aboveSince = t;
        this.quietSince = null;
        if (!this.motion && this.above >= 2 && t - this.aboveSince >= this.confirmMs) {
          this.motion = { start: t, peak: this.level, trigger };
          started = { start: t, peak: this.level, trigger };
        }
      } else {
        this.above = 0;
        this.aboveSince = null;
      }
      if (this.motion) {
        this.motion.peak = Math.max(this.motion.peak, this.level);
        if (this.level < endLevelFor(threshold)) {
          if (this.quietSince === null) this.quietSince = t;
          if (t - this.quietSince >= this.quietMs) ended = this.finish(t);
        } else {
          this.quietSince = null;
        }
      }
    }

    const round = (n) => Math.round((n || 0) * 100) / 100;
    return {
      ready: this.ready,
      level: round(this.level),
      levels: { signal: round(levels.signal), speed: round(Math.max(levels.down || 0, levels.up || 0)) },
      threshold,
      motion: this.motion ? { start: this.motion.start, peak: this.motion.peak, size: this.sizeFor(this.motion.peak) } : null,
      started,
      ended,
    };
  }

  finish(t) {
    const done = { start: this.motion.start, end: t, peak: this.motion.peak, size: this.sizeFor(this.motion.peak), trigger: this.motion.trigger };
    this.motion = null;
    this.above = 0;
    this.aboveSince = null;
    this.quietSince = null;
    return done;
  }
}

// The sensitivity setting whose alarm level is closest to (and not above) a
// wanted level. Used by the walk test.
function sensitivityFor(level) {
  return clamp(Math.ceil(1 + (5.1 - level) / 0.29 - 1e-9), 1, 10);
}

module.exports = { Detector, thresholdFor, sensitivityFor, percentile, WARMUP_MS };
