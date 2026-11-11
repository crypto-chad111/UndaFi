'use strict';

// UndaFi: start with "node server.js" (or double-click start.bat).
//
//   --demo        use a made-up signal (for trying the dashboard)
//   --port 4780   use another port
//   --open        open the dashboard in the browser once it is running

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createStore } = require('./src/store');
const { createSensor } = require('./src/sensors');
const { sendAlert } = require('./src/notify');
const { createProbe } = require('./src/probe');
const { Engine } = require('./src/engine');
const { createHandler } = require('./src/http');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const demo = flag('--demo');
const port = Number(option('--port') || process.env.PORT || 4780);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Please choose a port between 1024 and 65535.');
  process.exit(1);
}
if (port === 3001) {
  console.error('Port 3001 is reserved for another project. Please choose a different port.');
  process.exit(1);
}

// Tailscale gives every device an address that starts 100.64 to 100.127.
function tailscaleIps() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const [a, b] = item.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) found.push(item.address);
    }
  }
  return found;
}

// Demo data is kept apart so it never mixes into the real event log.
const store = createStore(path.join(__dirname, demo ? 'data-demo' : 'data'), {
  importPlanFrom: demo ? null : path.join(__dirname, 'data-demo'),
});
const engine = new Engine({
  store,
  demo,
  sendAlert,
  createProbe,
  createSensor: (handlers) => createSensor({ demo, ...handlers }),
});

// The dashboard listens on this PC and on its Tailscale address only, so
// other devices on the home WiFi (or a guest) cannot open it.
const servers = new Map();
const urls = () => [...servers.keys()].map((ip) => `http://${ip === '127.0.0.1' ? 'localhost' : ip}:${port}`);
const handler = createHandler({
  engine,
  store,
  getAllowedIps: () => [...servers.keys()],
  getUrls: urls,
  // Let the answer go out first, then stop. ON/OFF is remembered for next time.
  onQuit: () => setTimeout(() => process.exit(0), 200).unref(),
});

function openDashboard() {
  const target = `http://localhost:${port}`;
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', target], () => {});
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], () => {});
}

function listen(ip, fatal) {
  if (servers.has(ip)) return;
  const server = http.createServer(handler);
  server.on('error', (err) => {
    servers.delete(ip);
    // Started from the shortcut while it is already running: just show it.
    if (fatal && err.code === 'EADDRINUSE' && flag('--open')) {
      console.log('UndaFi is already running. Opening the dashboard.');
      openDashboard();
      setTimeout(() => process.exit(0), 1500);
      return;
    }
    if (fatal) {
      console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Start with another one: node server.js --port 4781` : err.message);
      process.exit(1);
    }
  });
  server.listen(port, ip, () => {
    servers.set(ip, server);
    console.log(`  ${ip === '127.0.0.1' ? 'On this PC:    ' : 'Over Tailscale:'} http://${ip === '127.0.0.1' ? 'localhost' : ip}:${port}`);
    engine.emit('state');
    if (ip === '127.0.0.1' && flag('--open')) openDashboard();
  });
}

function syncTailscale() {
  const ips = tailscaleIps();
  for (const ip of ips) listen(ip, false);
  for (const [ip, server] of servers) {
    if (ip !== '127.0.0.1' && !ips.includes(ip)) {
      server.close();
      servers.delete(ip);
    }
  }
}

console.log(`UndaFi${demo ? ' (DEMO: made-up signal)' : ''}`);
listen('127.0.0.1', true);
syncTailscale();
setInterval(syncTailscale, 30000).unref();
engine.resume();

process.on('SIGINT', () => process.exit(0));
