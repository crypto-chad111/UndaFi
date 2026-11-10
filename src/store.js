'use strict';

// Settings and the event log, kept as plain files in the data/ folder next to
// the app. Nothing is sent anywhere except the alerts the owner switches on.

const fs = require('node:fs');
const path = require('node:path');
const { defaultPlan, sanitizePlan, text } = require('./plan');

const MAX_EVENTS = 500;

function defaults() {
  return {
    mode: 'off',
    sensitivity: 7,
    confirmSec: 1,
    quietSec: 5,
    armDelaySec: 60,
    alertCooldownSec: 120,
    ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '' },
    email: { enabled: false, host: '', port: 465, user: '', pass: '', from: '', to: '' },
    plan: defaultPlan(),
  };
}

function int(value, lo, hi, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function sanitizeSettings(input, current) {
  const src = input && typeof input === 'object' ? input : {};
  const next = JSON.parse(JSON.stringify(current));
  if ('sensitivity' in src) next.sensitivity = int(src.sensitivity, 1, 10, current.sensitivity);
  if ('confirmSec' in src) next.confirmSec = int(src.confirmSec, 0, 15, current.confirmSec);
  if ('quietSec' in src) next.quietSec = int(src.quietSec, 2, 60, current.quietSec);
  if ('armDelaySec' in src) next.armDelaySec = int(src.armDelaySec, 0, 600, current.armDelaySec);
  if ('alertCooldownSec' in src) next.alertCooldownSec = int(src.alertCooldownSec, 10, 3600, current.alertCooldownSec);
  if (src.ntfy && typeof src.ntfy === 'object') {
    const n = src.ntfy;
    if ('enabled' in n) next.ntfy.enabled = Boolean(n.enabled);
    if ('server' in n) {
      const server = text(n.server, 200, 'https://ntfy.sh').replace(/\/+$/, '');
      next.ntfy.server = /^https?:\/\//i.test(server) ? server : 'https://ntfy.sh';
    }
    if ('topic' in n) next.ntfy.topic = text(n.topic, 64, '').replace(/[^A-Za-z0-9_-]/g, '');
  }
  if (src.email && typeof src.email === 'object') {
    const e = src.email;
    if ('enabled' in e) next.email.enabled = Boolean(e.enabled);
    if ('host' in e) next.email.host = text(e.host, 200, '').replace(/[^A-Za-z0-9.-]/g, '');
    if ('port' in e) next.email.port = int(e.port, 1, 65535, 465);
    if ('user' in e) next.email.user = text(e.user, 200, '');
    if ('from' in e) next.email.from = text(e.from, 200, '');
    if ('to' in e) next.email.to = text(e.to, 200, '');
    // The password is only ever replaced, never read back out.
    if (typeof e.pass === 'string' && e.pass.length > 0) next.email.pass = e.pass.slice(0, 200);
    if (e.clearPass === true) next.email.pass = '';
  }
  return next;
}

// What the dashboard is allowed to see: everything except the email password.
function publicSettings(config) {
  const { pass, ...email } = config.email;
  return {
    sensitivity: config.sensitivity,
    confirmSec: config.confirmSec,
    quietSec: config.quietSec,
    armDelaySec: config.armDelaySec,
    alertCooldownSec: config.alertCooldownSec,
    ntfy: { ...config.ntfy },
    email: { ...email, passSet: Boolean(pass) },
  };
}

function createStore(dir, options = {}) {
  const configFile = path.join(dir, 'config.json');
  const eventsFile = path.join(dir, 'events.json');
  fs.mkdirSync(dir, { recursive: true });

  function read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function write(file, value) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  }

  const saved = read(configFile, {});
  const base = defaults();
  let config = sanitizeSettings(saved, base);
  // sanitizeSettings only replaces a password when one is given; keep the saved one.
  if (saved.email && typeof saved.email.pass === 'string') config.email.pass = saved.email.pass;
  config.mode = ['off', 'test', 'armed'].includes(saved.mode) ? saved.mode : 'off';
  config.plan = saved.plan ? sanitizePlan(saved.plan) : base.plan;

  // A layout drawn while trying the demo is carried over, so it is not lost.
  if (config.plan.example && options.importPlanFrom) {
    const other = read(path.join(options.importPlanFrom, 'config.json'), null);
    if (other && other.plan && other.plan.example === false) {
      config.plan = sanitizePlan(other.plan);
      write(configFile, config);
    }
  }

  let events = read(eventsFile, []);
  if (!Array.isArray(events)) events = [];

  return {
    get config() {
      return config;
    },
    get events() {
      return events;
    },
    updateSettings(input) {
      config = sanitizeSettings(input, config);
      write(configFile, config);
    },
    setPlan(input) {
      config.plan = { ...sanitizePlan(input), example: false };
      write(configFile, config);
    },
    setMode(mode) {
      config.mode = mode;
      write(configFile, config);
    },
    addEvent(event) {
      events.push(event);
      if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
      write(eventsFile, events);
    },
    saveEvents() {
      write(eventsFile, events);
    },
    clearEvents() {
      events = [];
      write(eventsFile, events);
    },
  };
}

module.exports = { createStore, sanitizeSettings, publicSettings, defaults };
