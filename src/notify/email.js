'use strict';

// A small email sender (SMTP), so the app needs nothing installed besides
// Node. Port 465 uses an encrypted connection from the start; any other port
// (usually 587) starts plain and switches to encrypted before logging in.

const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');

const TIMEOUT_MS = 15000;

function header(value) {
  // eslint-disable-next-line no-control-regex
  const clean = String(value).replace(/[\r\n]+/g, ' ');
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function address(value) {
  const m = String(value).match(/<([^<>\s]+)>/);
  return (m ? m[1] : String(value)).replace(/[\s<>]/g, '');
}

function buildMessage({ from, to, subject, body }) {
  const domain = address(from).split('@')[1] || 'localhost';
  const encoded = Buffer.from(String(body), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `From: UndaFi <${address(from)}>`,
    `To: <${address(to)}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
  ].join('\r\n');
}

// options: { host, port, user, pass, from, to, subject, body }
// test-only extras: mode ('implicit' | 'starttls' | 'none'), ca
function sendEmail(options) {
  const { host, user, pass, to, subject, body } = options;
  const port = Number(options.port) || 465;
  const from = options.from || user;
  const mode = options.mode || (port === 465 ? 'implicit' : 'starttls');
  if (!host || !to || !from) return Promise.reject(new Error('Email is missing the server, the sender or the recipient.'));

  return new Promise((resolve, reject) => {
    let socket;
    let buffer = '';
    let waiting = null;
    let finished = false;

    function finish(err) {
      if (finished) return;
      finished = true;
      if (socket) socket.destroy();
      if (err) reject(err);
      else resolve();
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      for (;;) {
        // A reply ends with a line like "250 OK" (a space after the code).
        const lines = buffer.split('\r\n');
        const last = lines.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
        if (last === -1 || last === lines.length - 1) return;
        const reply = lines.slice(0, last + 1);
        buffer = lines.slice(last + 1).join('\r\n');
        const done = waiting;
        waiting = null;
        if (done) done({ code: Number(reply[last].slice(0, 3)), text: reply.join('\n') });
      }
    }

    function attach(s) {
      socket = s;
      socket.setTimeout(TIMEOUT_MS, () => finish(new Error('The email server did not answer in time.')));
      socket.on('data', onData);
      socket.on('error', (err) => finish(new Error(`Email connection problem: ${err.message}`)));
      socket.on('close', () => finish(new Error('The email server closed the connection early.')));
    }

    function reply() {
      return new Promise((res) => {
        waiting = res;
        if (buffer) onData('');
      });
    }

    async function command(line, expected, what) {
      if (line !== null) socket.write(`${line}\r\n`);
      const r = await reply();
      if (!expected.includes(r.code)) {
        throw new Error(`Email server refused ${what} (${r.text.replace(/\s+/g, ' ').slice(0, 160)})`);
      }
      return r;
    }

    async function talk() {
      const name = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
      await command(null, [220], 'the connection');
      await command(`EHLO ${name}`, [250], 'the greeting');
      if (mode === 'starttls') {
        await command('STARTTLS', [220], 'encryption');
        socket.removeAllListeners('data');
        socket.removeAllListeners('error');
        socket.removeAllListeners('close');
        socket.removeAllListeners('timeout');
        const plain = socket;
        await new Promise((res, rej) => {
          const secure = tls.connect({ socket: plain, servername: host, ca: options.ca }, res);
          secure.once('error', rej);
          attach(secure);
        });
        await command(`EHLO ${name}`, [250], 'the greeting');
      }
      if (user) {
        const token = Buffer.from(`\u0000${user}\u0000${pass || ''}`, 'utf8').toString('base64');
        await command(`AUTH PLAIN ${token}`, [235], 'the login. Check the username and password');
      }
      await command(`MAIL FROM:<${address(from)}>`, [250], 'the sender address');
      await command(`RCPT TO:<${address(to)}>`, [250, 251], 'the recipient address');
      await command('DATA', [354], 'the message');
      const message = buildMessage({ from, to, subject, body }).replace(/^\./gm, '..');
      await command(`${message}\r\n.`, [250], 'the message');
      socket.write('QUIT\r\n');
      finish();
    }

    const start = () => talk().catch(finish);
    if (mode === 'implicit') {
      attach(tls.connect({ host, port, servername: host, ca: options.ca }, start));
    } else {
      attach(net.connect({ host, port }, start));
    }
  });
}

module.exports = { sendEmail, buildMessage };
