'use strict';

// Reads the WiFi signal strength of this Windows PC by asking Windows itself
// ("netsh wlan show interfaces"). No drivers, no extra hardware.

const { execFile } = require('node:child_process');

// Turns the text Windows prints into { connected, dbm, ssid, saturated }.
// Only digits, "%" and the words SSID/Rssi are relied on, so it also works on
// Windows installs that are not in English.
function parseNetsh(text) {
  const blocks = String(text || '').split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const pct = block.match(/:\s*(\d{1,3})\s*%/);
    if (!pct) continue;
    const quality = Math.min(100, Number(pct[1]));
    const rssi = block.match(/^\s*Rssi\s*:\s*(-\d{1,3})\s*$/im);
    const ssid = block.match(/^\s*SSID\s*:\s*(.*?)\s*$/m);
    return {
      connected: true,
      dbm: rssi ? Number(rssi[1]) : quality / 2 - 100,
      ssid: ssid ? ssid[1] : '',
      // Without the Rssi line Windows tops out at 100% (-50 dBm): a very
      // strong signal then looks flat and movement can be missed.
      saturated: !rssi && quality >= 100,
    };
  }
  return { connected: false };
}

function describeFailure(err, stdout, stderr) {
  const text = `${stdout || ''}\n${stderr || ''}`.trim();
  if (/location/i.test(text)) {
    return {
      status: 'permission',
      detail:
        'Windows is blocking WiFi details. Open Settings > Privacy & security > Location, turn on "Location services" and "Let desktop apps access your location", then restart WiFi Sentinel.',
    };
  }
  if (err && err.code === 'ENOENT') {
    return { status: 'error', detail: 'Could not find the Windows "netsh" tool.' };
  }
  return { status: 'error', detail: (text || (err && err.message) || 'Unknown error').slice(0, 300) };
}

function createWindowsSensor({ intervalMs = 400, onSample, onStatus, run = execFile }) {
  let timer = null;
  let stopped = true;

  function poll() {
    if (stopped) return;
    run('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 5000 }, (err, stdout, stderr) => {
      if (stopped) return;
      if (err) {
        onStatus(describeFailure(err, stdout, stderr));
      } else {
        const parsed = parseNetsh(stdout);
        if (!parsed.connected) {
          onStatus({
            status: 'no-wifi',
            detail: 'This PC is not connected to WiFi. WiFi Sentinel needs the PC on WiFi (not only a network cable) to sense movement.',
          });
        } else {
          onStatus({
            status: 'ok',
            ssid: parsed.ssid,
            detail: parsed.saturated
              ? 'Signal reads 100%, which hides small changes. Detection works better if the PC is a room or two away from the router.'
              : '',
          });
          onSample({ t: Date.now(), dbm: parsed.dbm });
        }
      }
      timer = setTimeout(poll, intervalMs);
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      poll();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

module.exports = { createWindowsSensor, parseNetsh, describeFailure };
