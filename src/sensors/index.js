'use strict';

const { createWindowsSensor } = require('./wifi-windows');
const { createLinuxSensor } = require('./wifi-linux');
const { createDemoSensor } = require('./demo');

// Picks the right way to read the WiFi signal for this computer.
function createSensor({ demo, platform = process.platform, onSample, onStatus }) {
  if (demo) return createDemoSensor({ onSample, onStatus });
  if (platform === 'win32') return createWindowsSensor({ onSample, onStatus });
  if (platform === 'linux') return createLinuxSensor({ onSample, onStatus });
  return {
    start() {
      onStatus({ status: 'unsupported', detail: 'WiFi Sentinel can read the WiFi signal on Windows and Linux only for now.' });
    },
    stop() {},
  };
}

module.exports = { createSensor };
