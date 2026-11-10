'use strict';

const { sendEmail } = require('./email');

// Phone push through ntfy (https://ntfy.sh, or the owner's own ntfy server).
async function sendNtfy(ntfy, { title, body, urgent }, fetchImpl = fetch) {
  if (!ntfy.topic) throw new Error('No ntfy topic set.');
  const res = await fetchImpl(ntfy.server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: ntfy.topic,
      title,
      message: body,
      priority: urgent ? 5 : 3,
      tags: [urgent ? 'rotating_light' : 'white_check_mark'],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ntfy answered with error ${res.status}.`);
}

// Sends one alert through every channel that is switched on. Never throws:
// returns e.g. { ntfy: 'sent', email: 'failed: ...' } for the event log.
async function sendAlert(config, alert, deps = {}) {
  const jobs = {};
  if (config.ntfy.enabled) jobs.ntfy = sendNtfy(config.ntfy, alert, deps.fetch);
  if (config.email.enabled) {
    jobs.email = (deps.sendEmail || sendEmail)({ ...config.email, subject: alert.title, body: alert.body });
  }
  const result = {};
  await Promise.all(
    Object.entries(jobs).map(([name, job]) =>
      job.then(
        () => {
          result[name] = 'sent';
        },
        (err) => {
          result[name] = `failed: ${String((err && err.message) || err).slice(0, 200)}`;
        },
      ),
    ),
  );
  return result;
}

module.exports = { sendAlert, sendNtfy };
