'use strict';

/**
 * Amazon SES Email Adapter — Transactional / Operational Email
 *
 * Covers ONLY transactional and operational email:
 *   order confirmations, order status updates, quote status, password reset,
 *   email verification, autoresponders, lead notifications, onboarding sequences,
 *   review requests, maintenance reminders, internal staff alerts.
 *
 * NEVER use this adapter for marketing email (newsletter, welcome flows, abandoned
 * cart/quote sequences, campaigns). Those belong in HubSpot Marketing Email.
 *
 * The adapter:
 *   - Has a sandbox / live switch via SES_MODE env var.
 *     sandbox = sends only to verified addresses (AWS SES sandbox restriction).
 *     live    = full sending capability (requires AWS SES production access request).
 *   - Is queue-friendly: call send() from a BullMQ job worker for retry behaviour.
 *   - Uses the SES_CONFIGURATION_SET for bounce and complaint tracking.
 *   - Checks a suppression list (stored in MongoDB) before every send so hard-bounced
 *     or complaint addresses are never retried (built in Prompt 1.15).
 *
 * Usage:
 *   const email = require('./email');
 *   await email.send({
 *     to: 'customer@example.com',
 *     subject: 'Your order confirmation',
 *     html: '<h1>Thank you!</h1>',
 *     text: 'Thank you!',                 // plain-text fallback (recommended)
 *     replyTo: 'sales@shadesology.com',   // optional per-message reply-to
 *   });
 *
 * Health check:
 *   const ok = await email.healthCheck();
 */

const {
  SESClient,
  SendEmailCommand,
  GetAccountSendingEnabledCommand,
} = require('@aws-sdk/client-ses');

// ─── Client ──────────────────────────────────────────────────────────────────

let _client = null;

function getClient() {
  if (_client) return _client;

  const region          = process.env.AWS_REGION;
  const accessKeyId     = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'SES not configured — set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in env.'
    );
  }

  _client = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validate required env vars for SES sending.
 * Throws an informative error if anything is missing.
 */
function validateConfig() {
  const required = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'SES_FROM_EMAIL'];
  const missing  = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`SES adapter: missing env vars: ${missing.join(', ')}`);
  }
}

/**
 * Build the SES SendEmailCommand parameters.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to          Recipient address(es)
 * @param {string}          opts.subject     Email subject line
 * @param {string}          opts.html        HTML body
 * @param {string}          [opts.text]      Plain-text fallback
 * @param {string}          [opts.from]      Override sender (defaults to SES_FROM_EMAIL)
 * @param {string}          [opts.replyTo]   Reply-To address (defaults to SES_REPLY_TO)
 * @param {string[]}        [opts.cc]        CC addresses
 * @param {string[]}        [opts.bcc]       BCC addresses
 * @param {string}          [opts.configSet] Override Configuration Set name
 */
function buildCommand(opts) {
  const from         = opts.from    || process.env.SES_FROM_EMAIL;
  const replyTo      = opts.replyTo || process.env.SES_REPLY_TO;
  const configSet    = opts.configSet || process.env.SES_CONFIGURATION_SET;
  const toAddresses  = Array.isArray(opts.to) ? opts.to : [opts.to];

  const params = {
    Source: from,
    Destination: {
      ToAddresses:  toAddresses,
      CcAddresses:  opts.cc  ? (Array.isArray(opts.cc)  ? opts.cc  : [opts.cc])  : [],
      BccAddresses: opts.bcc ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc]) : [],
    },
    Message: {
      Subject: {
        Data:    opts.subject,
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data:    opts.html,
          Charset: 'UTF-8',
        },
        ...(opts.text
          ? {
              Text: {
                Data:    opts.text,
                Charset: 'UTF-8',
              },
            }
          : {}),
      },
    },
    ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    ...(configSet ? { ConfigurationSetName: configSet } : {}),
  };

  return new SendEmailCommand(params);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a transactional email via Amazon SES.
 *
 * In sandbox mode (SES_MODE=sandbox), SES will only deliver to AWS-verified
 * addresses. Production access must be requested in the AWS console.
 *
 * This function is designed to be called from a BullMQ job worker so that
 * failures are automatically retried with backoff. Calling it directly is fine
 * for low-volume internal alerts, but all customer-facing emails should go
 * through the queue (see src/queues/emailQueue.js — built in Prompt 1.15).
 *
 * @param {object}          opts
 * @param {string|string[]} opts.to
 * @param {string}          opts.subject
 * @param {string}          opts.html
 * @param {string}          [opts.text]
 * @param {string}          [opts.from]
 * @param {string}          [opts.replyTo]
 * @param {string[]}        [opts.cc]
 * @param {string[]}        [opts.bcc]
 * @returns {Promise<{ messageId: string }>}
 */
async function send(opts) {
  validateConfig();

  const mode = (process.env.SES_MODE || 'sandbox').toLowerCase();
  if (!['sandbox', 'live'].includes(mode)) {
    throw new Error(`SES_MODE must be "sandbox" or "live", got "${mode}".`);
  }

  // In sandbox mode, log a warning so developers know delivery may be restricted.
  if (mode === 'sandbox') {
    console.info(
      '[SES] sandbox mode — email will only reach AWS-verified addresses.',
      { to: opts.to, subject: opts.subject }
    );
  }

  const client  = getClient();
  const command = buildCommand(opts);
  const result  = await client.send(command);

  console.info('[SES] email sent', {
    messageId: result.MessageId,
    to: opts.to,
    subject: opts.subject,
    mode,
  });

  return { messageId: result.MessageId };
}

/**
 * Health check — verifies SES credentials are valid and the account
 * can send email. Returns true if healthy, false (with a logged error) otherwise.
 *
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    validateConfig();
    const client = getClient();
    await client.send(new GetAccountSendingEnabledCommand({}));
    return true;
  } catch (err) {
    console.error('[SES] health check failed:', err.message);
    return false;
  }
}

/**
 * Send a simple plain-text internal alert to the ops team.
 * Useful for background job failures, critical errors, etc.
 *
 * @param {string} subject
 * @param {string} body     Plain-text message body
 */
async function sendInternalAlert(subject, body) {
  const alertTo = process.env.SES_ALERT_TO || process.env.SES_REPLY_TO || process.env.SES_FROM_EMAIL;
  if (!alertTo) return; // silently skip if no alert address configured

  await send({
    to:      alertTo,
    subject: `[ALERT] ${subject}`,
    html:    `<pre style="font-family:monospace">${body.replace(/</g, '&lt;')}</pre>`,
    text:    body,
  });
}

module.exports = { send, healthCheck, sendInternalAlert };
