'use strict';

// The web dashboard and its small API.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_BODY = 100 * 1024;

function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

// Only answer when the browser is really talking to this app: on this PC, on
// its Tailscale address, or by its Tailscale name. This stops other websites
// from poking at the app through the browser.
function hostAllowed(hostHeader, allowedIps) {
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  if (name === 'localhost' || name === '127.0.0.1' || name === '[::1]') return true;
  if (allowedIps.includes(name)) return true;
  if (name.endsWith('.ts.net')) return true;
  return name === os.hostname().toLowerCase();
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Too much data.'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Could not read the request.'));
      }
    });
    req.on('error', reject);
  });
}

function createHandler({ engine, store, getAllowedIps, getUrls }) {
  const streams = new Set();

  function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) res.write(frame);
  }

  function fullState(withHistory) {
    return { ...engine.snapshot({ withHistory }), urls: getUrls() };
  }

  engine.on('state', () => broadcast('state', fullState(false)));
  engine.on('sample', (sample) => broadcast('sample', sample));
  // Keeps idle connections open and lets phones notice a dropped link.
  const ping = setInterval(() => broadcast('ping', { now: Date.now() }), 15000);
  if (ping.unref) ping.unref();

  const actions = {
    '/api/mode': async (body) => {
      engine.setMode(String(body.mode));
    },
    '/api/settings': async (body) => {
      store.updateSettings(body);
      engine.settingsChanged();
    },
    '/api/plan': async (body) => {
      store.setPlan(body);
      engine.settingsChanged();
    },
    '/api/test-alert': async () => ({ result: await engine.testAlert() }),
    '/api/walk-test': async (body) => {
      if (body.action === 'cancel') engine.cancelWalkTest();
      else engine.startWalkTest();
    },
    '/api/recalibrate': async () => {
      engine.recalibrate();
    },
    '/api/events/clear': async () => {
      store.clearEvents();
      engine.emit('state');
    },
  };

  return async function handler(req, res) {
    try {
      if (!hostAllowed(req.headers.host, getAllowedIps())) return send(res, 403, { error: 'Not allowed.' });
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;

      if (req.method === 'GET' && route === '/api/state') return send(res, 200, fullState(true));

      if (req.method === 'GET' && route === '/api/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 2000\n\n');
        streams.add(res);
        req.on('close', () => streams.delete(res));
        return undefined;
      }

      if (req.method === 'POST' && actions[route]) {
        // JSON-only plus a same-origin check: another website cannot send these.
        if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Not allowed.' });
        const origin = req.headers.origin;
        if (origin) {
          let originHost = '';
          try {
            originHost = new URL(origin).host.toLowerCase();
          } catch {
            /* not a URL */
          }
          if (originHost !== String(req.headers.host).toLowerCase()) return send(res, 403, { error: 'Not allowed.' });
        }
        const body = await readJson(req);
        const extra = (await actions[route](body)) || {};
        return send(res, 200, { ok: true, ...extra, state: fullState(false) });
      }

      if (req.method === 'GET') {
        const name = route === '/' ? 'index.html' : route.slice(1);
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return send(res, 404, { error: 'Not found.' });
        const file = path.join(PUBLIC_DIR, name);
        const type = TYPES[path.extname(file)];
        if (!type || !fs.existsSync(file)) return send(res, 404, { error: 'Not found.' });
        return send(res, 200, fs.readFileSync(file), type);
      }

      return send(res, 404, { error: 'Not found.' });
    } catch (err) {
      return send(res, 400, { error: String((err && err.message) || 'Something went wrong.').slice(0, 200) });
    }
  };
}

module.exports = { createHandler, hostAllowed };
