'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseNetsh, describeFailure } = require('../src/sensors/wifi-windows');
const { parseProcWireless } = require('../src/sensors/wifi-linux');

const ENGLISH = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX201 160MHz
    GUID                   : 11111111-2222-3333-4444-555555555555
    Physical address       : aa:bb:cc:dd:ee:ff
    Interface type         : Primary
    State                  : connected
    SSID                   : HomeNet
    BSSID                  : 11:22:33:44:55:66
    Network type           : Infrastructure
    Radio type             : 802.11ax
    Channel                : 36
    Receive rate (Mbps)    : 1201
    Transmit rate (Mbps)   : 1201
    Signal                 : 87%
    Rssi                   : -47
    Profile                : HomeNet

    Hosted network status  : Not available
`;

test('Windows: reads the exact signal when Windows shows it', () => {
  const r = parseNetsh(ENGLISH.replace(/\n/g, '\r\n'));
  assert.deepStrictEqual(r, { connected: true, dbm: -47, ssid: 'HomeNet', saturated: false });
});

test('Windows: falls back to the percentage on older Windows', () => {
  const r = parseNetsh(ENGLISH.replace(/^.*Rssi.*\n/m, ''));
  assert.strictEqual(r.dbm, -56.5);
  assert.strictEqual(r.saturated, false);
});

test('Windows: flags a signal stuck at 100%', () => {
  const r = parseNetsh(ENGLISH.replace(/^.*Rssi.*\n/m, '').replace('87%', '100%'));
  assert.strictEqual(r.saturated, true);
});

test('Windows: works when Windows is not in English', () => {
  const german = `
Es ist 1 Schnittstelle auf dem System vorhanden:

    Name                   : WLAN
    Beschreibung           : Intel(R) Wi-Fi 6 AX201 160MHz
    Status                 : Verbunden
    SSID                   : Zuhause
    BSSID                  : 11:22:33:44:55:66
    Empfangsrate (MBit/s)  : 866.7
    Signal                 : 74%
    Profil                 : Zuhause
`;
  const r = parseNetsh(german);
  assert.strictEqual(r.connected, true);
  assert.strictEqual(r.dbm, -63);
  assert.strictEqual(r.ssid, 'Zuhause');
});

test('Windows: not connected to WiFi', () => {
  const r = parseNetsh('There is 1 interface on the system:\r\n\r\n    Name : Wi-Fi\r\n    State : disconnected\r\n');
  assert.strictEqual(r.connected, false);
  assert.strictEqual(parseNetsh('').connected, false);
});

test('Windows: explains the location permission block', () => {
  const f = describeFailure(new Error('exit 1'), 'Network shell commands need location permission to access WLAN information.', '');
  assert.strictEqual(f.status, 'permission');
  assert.match(f.detail, /Location/);
});

test('Linux: reads /proc/net/wireless', () => {
  const text = `Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE
 face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22
 wlan0: 0000   60.  -50.  -256        0      0      0      0      0        0
`;
  assert.deepStrictEqual(parseProcWireless(text), { connected: true, iface: 'wlan0', dbm: -50 });
  assert.strictEqual(parseProcWireless(text.split('\n').slice(0, 2).join('\n')).connected, false);
});
