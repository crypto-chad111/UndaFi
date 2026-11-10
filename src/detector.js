'use strict';

// Motion detector for one WiFi link.
//
// It is fed signal-strength samples (dBm) a few times a second. A person or
// animal moving through the path between the two radios makes the signal
// wobble. The detector compares how much the signal is wobbling right now
// with how much it normally wobbles when the house is still.

const WINDOW_MS = 8000; // "right now" = the last 8 seconds
const MEAN_MS = 60000; // normal signal level = median of the last minute
const HISTORY_MS = 300000; // normal wobble = learned from the last 5 minutes
const WARMUP_MS = 15000; // listen this long before judging anything
const STD_FLOOR = 0.4; // dB; WiFi cards report whole or half dB steps
const END_QUIET_MS = 5000; // movement ends after 5 quiet seconds
const GAP_RESET_MS = 10000; // a silence this long means the sensor dropped out

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Sensitivity 1 (least) to 10 (most) -> how many times the normal wobble
// counts as movement.
function thresholdFor(sensitivity) {
  const s = clamp(Number(sensitivity) || 6, 1, 10);
  return Math.round((5.5 - 0.4 * s) * 100) / 100;
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

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

class Detector {
  constructor(options = {}) {
    this.sensitivity = options.sensitivity || 6;
    this.reset();
  }

  reset() {
    this.samples = []; // { t, dbm } for the last minute
    this.stdHistory = []; // { t, std } one per second for the last 5 minutes
    this.firstAt = null;
    this.lastAt = null;
    this.above = 0;
    this.quietSince = null;
    this.motion = null; // { start, peak } while movement is in progress
    this.level = 0;
    this.baseStd = STD_FLOOR;
  }

  setSensitivity(sensitivity) {
    this.sensitivity = sensitivity;
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

  // Returns { ready, level, threshold, motion, started?, ended? }.
  push(t, dbm) {
    let ended = null;
    if (this.lastAt !== null && t - this.lastAt > GAP_RESET_MS) {
      if (this.motion) ended = this.finish(this.lastAt);
      this.reset();
    }
    if (this.firstAt === null) this.firstAt = t;
    this.lastAt = t;

    this.samples.push({ t, dbm });
    while (this.samples.length && this.samples[0].t < t - MEAN_MS) this.samples.shift();

    const recent = [];
    const older = [];
    for (const s of this.samples) (s.t > t - WINDOW_MS ? recent : older).push(s.dbm);
    const shortStd = std(recent);
    const shortMean = mean(recent);

    const lastStd = this.stdHistory[this.stdHistory.length - 1];
    if (recent.length >= 5 && (!lastStd || t - lastStd.t >= 1000)) {
      this.stdHistory.push({ t, std: shortStd });
      while (this.stdHistory.length && this.stdHistory[0].t < t - HISTORY_MS) this.stdHistory.shift();
    }

    // The quietest quarter of recent history is "the house when still". This
    // stays correct even if someone was moving for part of that time.
    this.baseStd = Math.max(STD_FLOOR, percentile(this.stdHistory.map((h) => h.std), 0.25));
    const baseMean = percentile(older.length >= 5 ? older : this.samples.map((s) => s.dbm), 0.5);

    const wobble = shortStd / this.baseStd;
    const shift = Math.abs(shortMean - baseMean) / (3 * this.baseStd);
    this.level = this.ready && recent.length >= 5 ? Math.max(wobble, shift) : 0;

    const threshold = this.threshold;
    let started = null;
    if (this.ready) {
      if (this.level >= threshold) {
        this.above += 1;
        this.quietSince = null;
        if (!this.motion && this.above >= 2) {
          this.motion = { start: t, peak: this.level };
          started = { start: t, peak: this.level };
        }
      } else {
        this.above = 0;
      }
      if (this.motion) {
        this.motion.peak = Math.max(this.motion.peak, this.level);
        if (this.level < threshold * 0.6) {
          if (this.quietSince === null) this.quietSince = t;
          if (t - this.quietSince >= END_QUIET_MS) ended = this.finish(t);
        } else {
          this.quietSince = null;
        }
      }
    }

    return {
      ready: this.ready,
      level: Math.round(this.level * 100) / 100,
      threshold,
      baseStd: Math.round(this.baseStd * 100) / 100,
      motion: this.motion ? { start: this.motion.start, peak: this.motion.peak, size: this.sizeFor(this.motion.peak) } : null,
      started,
      ended,
    };
  }

  finish(t) {
    const done = { start: this.motion.start, end: t, peak: this.motion.peak, size: this.sizeFor(this.motion.peak) };
    this.motion = null;
    this.above = 0;
    this.quietSince = null;
    return done;
  }
}

module.exports = { Detector, thresholdFor, WARMUP_MS };
