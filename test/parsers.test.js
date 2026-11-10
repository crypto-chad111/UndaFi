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
  assert.deepStrictEqual(r, { connected: true, rx: 1201, tx: 1201, dbm: -47, ssid: 'HomeNet', saturated: false });
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
    Empfangsrate (MBit/s)  : 866,7
    Übertragungsrate (MBit/s) : 650
    Signal                 : 74%
    Profil                 : Zuhause
`;
  const r = parseNetsh(german);
  assert.strictEqual(r.connected, true);
  assert.strictEqual(r.dbm, -63);
  assert.strictEqual(r.ssid, 'Zuhause');
  assert.strictEqual(r.rx, 866.7);
  assert.strictEqual(r.tx, 650);
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

const { parseWindowsRoutes, parseLinuxRoutes, isPrivate } = require('../src/probe');

test('finds the home router on Windows', () => {
  const text = `
===========================================================================
Interface List
 12...aa bb cc dd ee ff ......Intel(R) Wi-Fi 6 AX201 160MHz
===========================================================================

IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.23     35
          0.0.0.0          0.0.0.0         On-link     100.101.102.103      5
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
      192.168.1.0    255.255.255.0         On-link      192.168.1.23    291
===========================================================================
Persistent Routes:
  None
`;
  assert.deepStrictEqual(parseWindowsRoutes(text.replace(/\n/g, '\r\n')), [{ gateway: '192.168.1.1', from: '192.168.1.23' }]);
  assert.deepStrictEqual(parseWindowsRoutes('nothing useful'), []);
});

test('finds the home router on Linux', () => {
  assert.deepStrictEqual(parseLinuxRoutes('default via 192.168.0.1 dev wlan0 proto dhcp metric 600\n'), [{ gateway: '192.168.0.1' }]);
});

test('the keep-busy packets only ever go to home-network addresses', () => {
  assert.ok(isPrivate('192.168.1.1'));
  assert.ok(isPrivate('10.0.0.138'));
  assert.ok(isPrivate('172.16.0.1'));
  assert.ok(!isPrivate('8.8.8.8'));
  assert.ok(!isPrivate('100.101.102.103'));
  assert.ok(!isPrivate('172.32.0.1'));
});

test('the keep-busy trickle really sends, about ten a second, and stops when told', async () => {
  const dgram = require('node:dgram');
  const { createProbe } = require('../src/probe');
  const sink = dgram.createSocket('udp4');
  let got = 0;
  sink.on('message', () => {
    got += 1;
  });
  await new Promise((r) => sink.bind(0, '127.0.0.1', r));
  const states = [];
  const probe = createProbe({
    platform: 'linux',
    run: (cmd, args, opts, cb) => cb(null, 'default via 127.0.0.1 dev lo\n'),
    allowed: () => true,
    port: sink.address().port,
    onStatus: (s) => states.push(s.state),
  });
  probe.start();
  await new Promise((r) => setTimeout(r, 1050));
  probe.stop();
  const sent = got;
  await new Promise((r) => setTimeout(r, 400));
  sink.close();
  assert.ok(sent >= 7 && sent <= 12, `sent ${sent} packets in a second`);
  assert.strictEqual(got, sent, 'nothing more after stop');
  assert.deepStrictEqual(states, ['on', 'off']);
});

test('the keep-busy trickle refuses a router address outside the home network', async () => {
  const { createProbe } = require('../src/probe');
  const states = [];
  const probe = createProbe({ platform: 'linux', run: (cmd, args, opts, cb) => cb(null, 'default via 8.8.8.8 dev eth0\n'), onStatus: (s) => states.push(s.state) });
  probe.start();
  await new Promise((r) => setTimeout(r, 50));
  probe.stop();
  assert.deepStrictEqual(states, ['no-router', 'off']);
});
