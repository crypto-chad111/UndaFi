'use strict';

// "Keep the link busy": sends a tiny packet to the home router ten times a
// second while monitoring is on.
//
// Why: many WiFi cards only refresh their signal and speed readings when
// data is flowing. On an idle link the reading goes stale and movement is
// missed. This trickle (about half a kilobyte a second) stays inside the
// home network: it goes to the router and nowhere else.

const dgram = require('node:dgram');
const { execFile } = require('node:child_process');

const INTERVAL_MS = 100;
const REFRESH_MS = 60000;
const DISCARD_PORT = 9; // the standard "throw this away" port

// Windows: "route print -4 0.0.0.0" -> [{ gateway, from }]
function parseWindowsRoutes(text) {
  const routes = [];
  const ip = '(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})';
  const line = new RegExp(`^\\s*0\\.0\\.0\\.0\\s+0\\.0\\.0\\.0\\s+${ip}\\s+${ip}\\s+\\d+\\s*$`, 'gm');
  let m;
  while ((m = line.exec(String(text || ''))) !== null) {
    if (!routes.some((r) => r.gateway === m[1] && r.from === m[2])) routes.push({ gateway: m[1], from: m[2] });
  }
  return routes;
}

// Linux: "ip -4 route show default" -> [{ gateway }]
function parseLinuxRoutes(text) {
  const routes = [];
  const line = /^default via (\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/gm;
  let m;
  while ((m = line.exec(String(text || ''))) !== null) {
    if (!routes.some((r) => r.gateway === m[1])) routes.push({ gateway: m[1] });
  }
  return routes;
}

// Only ever talk to addresses inside a home network.
function isPrivate(address) {
  const [a, b] = String(address).split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function findRouters(platform, run, allowed, done) {
  const finish = (parse) => (err, stdout) => done(err ? [] : parse(stdout).filter((r) => allowed(r.gateway)).slice(0, 3));
  if (platform === 'win32') run('route', ['print', '-4', '0.0.0.0'], { windowsHide: true, timeout: 5000 }, finish(parseWindowsRoutes));
  else if (platform === 'linux') run('ip', ['-4', 'route', 'show', 'default'], { timeout: 5000 }, finish(parseLinuxRoutes));
  else done([]);
}

// `allowed` and `port` exist so the tests can point it at a local listener.
function createProbe({ platform = process.platform, run = execFile, onStatus = () => {}, allowed = isPrivate, port = DISCARD_PORT } = {}) {
  let sockets = [];
  let sendTimer = null;
  let refreshTimer = null;
  let running = false;

  function close() {
    clearInterval(sendTimer);
    sendTimer = null;
    for (const s of sockets) {
      try {
        s.socket.close();
      } catch {
        /* already closed */
      }
    }
    sockets = [];
  }

  function refresh() {
    findRouters(platform, run, allowed, (routes) => {
      if (!running) return;
      const same = routes.length === sockets.length && routes.every((r, i) => sockets[i].gateway === r.gateway && sockets[i].from === r.from);
      if (same && routes.length) return;
      close();
      if (!routes.length) return onStatus({ state: 'no-router', targets: [] });
      const payload = Buffer.alloc(32);
      for (const route of routes) {
        const socket = dgram.createSocket('udp4');
        socket.on('error', () => {}); // a refused or unreachable packet is expected and harmless
        // Sending from the adapter's own address keeps the packet on that adapter.
        if (route.from) socket.bind(0, route.from);
        socket.unref();
        sockets.push({ socket, gateway: route.gateway, from: route.from });
      }
      sendTimer = setInterval(() => {
        for (const s of sockets) {
          try {
            s.socket.send(payload, port, s.gateway, () => {});
          } catch {
            /* the network went away; the next refresh sorts it out */
          }
        }
      }, INTERVAL_MS);
      if (sendTimer.unref) sendTimer.unref();
      onStatus({ state: 'on', targets: routes.map((r) => r.gateway) });
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      refresh();
      refreshTimer = setInterval(refresh, REFRESH_MS);
      if (refreshTimer.unref) refreshTimer.unref();
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(refreshTimer);
      close();
      onStatus({ state: 'off', targets: [] });
    },
  };
}

module.exports = { createProbe, parseWindowsRoutes, parseLinuxRoutes, isPrivate };
