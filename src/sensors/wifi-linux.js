'use strict';

// Reads the WiFi signal strength on Linux from /proc/net/wireless.

const fs = require('node:fs');

// Example file:
//   Inter-| sta-|   Quality        |   Discarded packets ...
//    face | tus | link level noise |  nwid  crypt   frag ...
//    wlan0: 0000   60.  -50.  -256        0      0      0 ...
function parseProcWireless(text) {
  const lines = String(text || '').split(/\r?\n/).slice(2);
  for (const line of lines) {
    const m = line.match(/^\s*([^:\s]+):\s*\S+\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    if (!m) continue;
    let level = Number(m[3]);
    if (!Number.isFinite(level)) continue;
    if (level > 0) level -= 256; // some drivers report an unsigned byte
    return { connected: true, iface: m[1], dbm: level };
  }
  return { connected: false };
}

function createLinuxSensor({ intervalMs = 400, onSample, onStatus, file = '/proc/net/wireless' }) {
  let timer = null;
  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        fs.readFile(file, 'utf8', (err, text) => {
          if (!timer) return;
          if (err) return onStatus({ status: 'error', detail: 'Could not read WiFi details from this computer.' });
          const parsed = parseProcWireless(text);
          if (!parsed.connected) {
            return onStatus({ status: 'no-wifi', detail: 'This computer is not connected to WiFi.' });
          }
          onStatus({ status: 'ok', ssid: parsed.iface, detail: '' });
          onSample({ t: Date.now(), dbm: parsed.dbm });
        });
      }, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createLinuxSensor, parseProcWireless };
