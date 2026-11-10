'use strict';

// The heart of the app: turns monitoring on and off, feeds the signal into
// the detector, writes the event log and sends alerts.
//
// Modes:
//   off     nothing is read, nothing is sent
//   test    watching and drawing, but no alerts (for trying it out at home)
//   arming  the countdown after switching on, so the owner can leave
//   armed   watching, and movement sends alerts

const { EventEmitter } = require('node:events');
const { Detector } = require('./detector');
const { roomsOnLink } = require('./plan');
const { publicSettings } = require('./store');

const HISTORY_MS = 120000;
const SENSOR_LOST_MS = 60000;

class Engine extends EventEmitter {
  constructor({ store, createSensor, sendAlert, demo = false, now = Date.now }) {
    super();
    this.store = store;
    this.sendAlert = sendAlert;
    this.demo = demo;
    this.now = now;
    this.detector = new Detector(this.detectorOptions());
    this.sensor = createSensor({
      onSample: (sample) => this.onSample(sample),
      onStatus: (status) => this.onSensorStatus(status),
    });
    this.mode = 'off';
    this.armAt = null;
    this.sensorState = { status: 'idle', detail: '', ssid: '' };
    this.sensorBadSince = null;
    this.sensorLostAlerted = false;
    this.history = [];
    this.current = null; // the event in progress
    this.lastAlertAt = 0;
    this.lastResult = { ready: false, level: 0, threshold: this.detector.threshold, motion: null };
    this.lastNotify = null;
    this.timer = null;
  }

  detectorOptions() {
    const c = this.store.config;
    return { sensitivity: c.sensitivity, confirmMs: c.confirmSec * 1000, quietMs: c.quietSec * 1000 };
  }

  // Called once at startup: carry on in whatever mode the app was left in.
  resume() {
    // An event that was open when the app last stopped can never be closed now.
    let dirty = false;
    for (const e of this.store.events) {
      if (!e.end) {
        e.end = e.start;
        dirty = true;
      }
    }
    if (dirty) this.store.saveEvents();
    if (this.store.config.mode !== 'off') this.setMode(this.store.config.mode);
  }

  setMode(target) {
    if (!['off', 'test', 'armed'].includes(target)) throw new Error('Unknown mode.');
    const wasOff = this.mode === 'off';
    this.store.setMode(target);
    if (target === 'off') {
      this.sensor.stop();
      clearInterval(this.timer);
      this.timer = null;
      this.closeCurrent(this.now());
      this.detector.reset();
      this.history = [];
      this.mode = 'off';
      this.armAt = null;
      this.sensorState = { status: 'idle', detail: '', ssid: '' };
      this.sensorBadSince = null;
      this.sensorLostAlerted = false;
      this.lastResult = { ready: false, level: 0, threshold: this.detector.threshold, motion: null };
    } else {
      if (target === 'armed') {
        const delay = this.store.config.armDelaySec * 1000;
        if (this.mode !== 'armed' && this.mode !== 'arming') {
          this.armAt = this.now() + delay;
          this.mode = delay > 0 ? 'arming' : 'armed';
        }
      } else {
        this.mode = 'test';
        this.armAt = null;
      }
      if (wasOff) {
        this.sensorState = { status: 'starting', detail: '', ssid: '' };
        this.sensor.start();
        this.timer = setInterval(() => this.tick(), 1000);
        if (this.timer.unref) this.timer.unref();
      }
    }
    this.emit('state');
  }

  tick() {
    const now = this.now();
    if (this.mode === 'arming' && now >= this.armAt) {
      this.mode = 'armed';
      this.emit('state');
    }
    // A security app must say so when it goes blind.
    if (this.mode === 'armed' && this.sensorBadSince && !this.sensorLostAlerted && now - this.sensorBadSince >= SENSOR_LOST_MS) {
      this.sensorLostAlerted = true;
      this.alert({
        title: 'WiFi Sentinel cannot see the WiFi signal',
        body: `Monitoring is switched on but the WiFi signal has been unreadable for a minute. ${this.sensorState.detail || ''}`.trim(),
        urgent: true,
      });
    }
  }

  onSensorStatus(status) {
    const next = { status: status.status, detail: status.detail || '', ssid: status.ssid || '' };
    if (next.status === 'ok') {
      this.sensorBadSince = null;
      this.sensorLostAlerted = false;
    } else if (!this.sensorBadSince) {
      this.sensorBadSince = this.now();
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.sensorState);
    this.sensorState = next;
    if (changed) this.emit('state');
  }

  onSample({ t, dbm }) {
    if (this.mode === 'off') return;
    const result = this.detector.push(t, dbm);
    const wasReady = this.lastResult.ready;
    this.lastResult = result;
    this.history.push({ t, dbm, level: result.level });
    while (this.history.length && this.history[0].t < t - HISTORY_MS) this.history.shift();

    let changed = wasReady !== result.ready;
    if (result.ended) {
      this.closeCurrent(result.ended.end, result.ended);
      changed = true;
    }
    if (result.started) {
      this.openEvent(result.started);
      changed = true;
    }
    if (this.current && result.motion) {
      const size = result.motion.size;
      if (size !== this.current.size) changed = true;
      this.current.peak = Math.round(result.motion.peak * 100) / 100;
      this.current.size = size;
    }
    this.emit('sample', { t, dbm, level: result.level });
    if (changed) this.emit('state');
  }

  openEvent(started) {
    const rooms = roomsOnLink(this.store.config.plan).map((r) => r.name);
    const armed = this.mode === 'armed';
    this.current = {
      id: `${started.start}-${Math.random().toString(36).slice(2, 7)}`,
      start: started.start,
      end: null,
      peak: Math.round(started.peak * 100) / 100,
      size: this.detector.sizeFor(started.peak),
      rooms,
      armed,
      demo: this.demo || undefined,
      alert: null,
    };
    this.store.addEvent(this.current);
    const cooldown = this.store.config.alertCooldownSec * 1000;
    if (armed && started.start - this.lastAlertAt >= cooldown) {
      this.lastAlertAt = started.start;
      const event = this.current;
      const time = new Date(started.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const where = rooms.length ? `Somewhere around: ${rooms.join(', ')}.` : 'Between the PC and the router.';
      this.alert({ title: 'Movement detected at home', body: `Movement detected at ${time}. ${where}`, urgent: true }).then((result) => {
        event.alert = result;
        this.store.saveEvents();
        this.emit('state');
      });
    }
  }

  closeCurrent(end, ended) {
    if (!this.current) return;
    this.current.end = end;
    if (ended) {
      this.current.peak = Math.round(ended.peak * 100) / 100;
      this.current.size = ended.size;
    }
    this.current = null;
    this.store.saveEvents();
  }

  async alert({ title, body, urgent }) {
    const prefix = this.demo ? '[DEMO] ' : '';
    const config = this.store.config;
    if (!config.ntfy.enabled && !config.email.enabled) {
      this.lastNotify = { at: this.now(), result: { none: 'No alert channel is switched on.' } };
      return { none: 'No alert channel is switched on.' };
    }
    const result = await this.sendAlert(config, { title: prefix + title, body, urgent });
    this.lastNotify = { at: this.now(), result };
    return result;
  }

  async testAlert() {
    const result = await this.alert({
      title: 'WiFi Sentinel test alert',
      body: 'This is a test. If you can read this, alerts are working.',
      urgent: false,
    });
    this.emit('state');
    return result;
  }

  recalibrate() {
    this.closeCurrent(this.now());
    this.detector.reset();
    this.lastResult = { ready: false, level: 0, threshold: this.detector.threshold, motion: null };
    this.emit('state');
  }

  settingsChanged() {
    this.detector.configure(this.detectorOptions());
    this.emit('state');
  }

  snapshot({ withHistory = false } = {}) {
    const config = this.store.config;
    const r = this.lastResult;
    const snap = {
      demo: this.demo,
      mode: this.mode,
      armAt: this.armAt,
      now: this.now(),
      sensor: this.sensorState,
      detector: { ready: r.ready, level: r.level, threshold: this.detector.threshold },
      motion: this.current ? { start: this.current.start, size: this.current.size } : null,
      linkRooms: roomsOnLink(config.plan).map((room) => room.id),
      settings: publicSettings(config),
      plan: config.plan,
      events: this.store.events.slice(-100).reverse(),
      lastNotify: this.lastNotify,
    };
    if (withHistory) snap.history = this.history;
    return snap;
  }
}

module.exports = { Engine };
