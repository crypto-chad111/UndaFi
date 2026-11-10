'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sendEmail } = require('../src/notify/email');

// A pretend mail server that records what the app says to it.
function talk(socket, log, { starttls, secureContext, rejectLogin } = {}) {
  let inData = false;
  let buffer = '';
  const say = (line) => socket.write(`${line}\r\n`);
  say('220 test server ready');
  socket.on('data', function onData(chunk) {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          say('250 queued');
        } else log.data.push(line);
        continue;
      }
      log.commands.push(line);
      if (/^EHLO/.test(line)) socket.write(`250-test\r\n${starttls ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
      else if (line === 'STARTTLS') {
        say('220 go ahead');
        socket.removeListener('data', onData);
        const secure = new tls.TLSSocket(socket, { isServer: true, secureContext });
        log.upgraded = true;
        talkSecure(secure, log);
        return;
      } else if (/^AUTH PLAIN/.test(line)) say(rejectLogin ? '535 bad credentials' : '235 ok');
      else if (/^MAIL FROM|^RCPT TO/.test(line)) say('250 ok');
      else if (line === 'DATA') {
        inData = true;
        say('354 send it');
      } else if (line === 'QUIT') socket.end('221 bye\r\n');
    }
  });
  socket.on('error', () => {});
}

function talkSecure(socket, log) {
  // After STARTTLS the same conversation continues, minus the first greeting.
  const fake = { write: (d) => socket.write(d), end: (d) => socket.end(d), on: (...a) => socket.on(...a), removeListener: (...a) => socket.removeListener(...a) };
  const original = fake.write;
  let first = true;
  fake.write = (d) => {
    if (first) {
      first = false; // swallow the "220 ready" that talk() always sends
      return true;
    }
    return original(d);
  };
  talk(fake, log, {});
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

let cert = null;
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-cert-'));
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'],
    { stdio: 'ignore' },
  );
  cert = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
} catch {
  cert = null;
}

const mail = { user: 'me@example.com', pass: 'app-pass', to: 'you@example.com', subject: 'Bewegung in der Küche', body: 'Movement detected.\n.hidden dot line' };

function check(log) {
  assert.ok(log.commands.some((c) => c.startsWith('EHLO ')));
  const auth = log.commands.find((c) => c.startsWith('AUTH PLAIN '));
  assert.strictEqual(Buffer.from(auth.slice(11), 'base64').toString(), '\u0000me@example.com\u0000app-pass');
  assert.ok(log.commands.includes('MAIL FROM:<me@example.com>'));
  assert.ok(log.commands.includes('RCPT TO:<you@example.com>'));
  const text = log.data.join('\n');
  assert.match(text, /Subject: =\?UTF-8\?B\?/);
  const body = Buffer.from(text.split('\n\n')[1].replace(/\n/g, ''), 'base64').toString();
  assert.strictEqual(body, mail.body);
}

test('email: full conversation with a mail server', async () => {
  const log = { commands: [], data: [] };
  const server = net.createServer((s) => talk(s, log));
  const port = await listen(server);
  await sendEmail({ ...mail, host: '127.0.0.1', port, mode: 'none' });
  server.close();
  check(log);
});

test('email: a wrong password gives a clear error', async () => {
  const log = { commands: [], data: [] };
  const server = net.createServer((s) => talk(s, log, { rejectLogin: true }));
  const port = await listen(server);
  await assert.rejects(sendEmail({ ...mail, host: '127.0.0.1', port, mode: 'none' }), /login/);
  server.close();
  assert.strictEqual(log.data.length, 0);
});

test('email: encrypted from the start (port 465 style)', { skip: !cert }, async () => {
  const log = { commands: [], data: [] };
  const server = tls.createServer(cert, (s) => talk(s, log));
  const port = await listen(server);
  await sendEmail({ ...mail, host: 'localhost', port, mode: 'implicit', ca: cert.cert });
  server.close();
  check(log);
});

test('email: switches to encrypted before logging in (port 587 style)', { skip: !cert }, async () => {
  const log = { commands: [], data: [] };
  const secureContext = tls.createSecureContext(cert);
  const server = net.createServer((s) => talk(s, log, { starttls: true, secureContext }));
  const port = await listen(server);
  await sendEmail({ ...mail, host: 'localhost', port, mode: 'starttls', ca: cert.cert });
  server.close();
  assert.strictEqual(log.upgraded, true);
  assert.ok(log.commands.indexOf('STARTTLS') < log.commands.findIndex((c) => c.startsWith('AUTH')), 'password only sent after encryption');
  check(log);
});

test('email: refuses an untrusted mail server certificate', { skip: !cert }, async () => {
  const log = { commands: [], data: [] };
  const server = tls.createServer(cert, (s) => talk(s, log));
  server.on('tlsClientError', () => {});
  const port = await listen(server);
  await assert.rejects(sendEmail({ ...mail, host: 'localhost', port, mode: 'implicit' }));
  server.close();
  assert.strictEqual(log.commands.length, 0);
});
