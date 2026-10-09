'use strict';

/**
 * Quote Scheduler — BullMQ scheduled jobs for quote expiry and follow-up reminders.
 *
 * Two recurring jobs:
 *
 *   1. expire-stale-quotes  (runs every hour)
 *      Marks submitted/in_review/quoted quotes past their expiresAt as 'expired'.
 *      Sends a "your quote has expired" email to the customer via the SES queue.
 *
 *   2. send-followup-reminders  (runs every hour)
 *      Finds 'quoted' quotes where:
 *        - expiresAt is within the next FOLLOWUP_DAYS days
 *        - followUpSentAt is null (reminder not yet sent)
 *      Sends a single follow-up reminder via SES and records followUpSentAt.
 *
 * Both jobs are idempotent — re-running them produces no duplicate side effects.
 *
 * Configuration (env vars, all optional):
 *   QUOTE_EXPIRY_DAYS   — days until a quote expires (default 30)
 *   QUOTE_FOLLOWUP_DAYS — days before expiry to send the reminder (default 3)
 */

const { Queue, Worker } = require('bullmq');
const { createHash, randomBytes } = require('node:crypto');
const { createRedisConnection, isRedisEnabled } = require('../config/redis');
const Quote = require('../models/Quote');
const { getQueue } = require('../queues/index');

const configuredFollowupDays = Number(process.env.QUOTE_FOLLOWUP_DAYS);
const FOLLOWUP_DAYS = Number.isFinite(configuredFollowupDays) && configuredFollowupDays > 0
  ? configuredFollowupDays
  : 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enqueueEmail(opts) {
  try {
    getQueue('email').add('send', opts, { attempts: 5 }).catch((err) =>
      console.error('[QuoteScheduler] email queue error:', err.message)
    );
  } catch {
    console.warn('[QuoteScheduler] email queue unavailable');
  }
}

function statusUrl(quote, frontendUrl, token) {
  return quote.user
    ? `${frontendUrl}/account`
    : `${frontendUrl}/quote/status/${encodeURIComponent(quote.referenceNumber)}?token=${encodeURIComponent(token)}`;
}

async function createGuestStatusToken(quote) {
  if (quote.user) return null;
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await Quote.updateOne({ _id: quote._id }, { $addToSet: { guestTokenHashes: tokenHash } });
  return token;
}

// ─── Job processors ───────────────────────────────────────────────────────────

async function expireStaleQuotes(job) {
  job.log('Running expire-stale-quotes');
  const now = new Date();
  const frontendUrl = process.env.FRONTEND_URL || 'https://shadesology.com';

  // Find quotes that are past their expiry and still in an active status
  const staleQuotes = await Quote.find({
    status:    { $in: ['submitted', 'in_review', 'quoted'] },
    expiresAt: { $lte: now },
  })
    .populate('user', 'firstName lastName email')
    .lean();

  job.log(`Found ${staleQuotes.length} stale quote(s) to expire.`);

  for (const quote of staleQuotes) {
    await Quote.findByIdAndUpdate(quote._id, {
      status: 'expired',
      $push: {
        statusHistory: {
          status:    'expired',
          note:      'Automatically expired by scheduler.',
          at:        now,
        },
      },
    });

    // Notify the customer
    const contactEmail = quote.guestContact?.email || quote.user?.email;
    const contactName  = quote.guestContact?.firstName || quote.user?.firstName || 'Customer';
    const token = await createGuestStatusToken(quote);
    const trackingUrl = statusUrl(quote, frontendUrl, token);

    if (contactEmail) {
      enqueueEmail({
        to:      contactEmail,
        subject: `Your quote ${quote.referenceNumber} has expired`,
        html: `
          <h2 style="color:#1B4332">Quote Expired</h2>
          <p>Hi ${contactName},</p>
          <p>Your quote <strong>${quote.referenceNumber}</strong> has expired.</p>
          <p>If you are still interested, please submit a new quote request and we will be happy to provide updated pricing.</p>
          <p><a href="${trackingUrl}">View quote status</a></p>
          <p>
            <a href="${frontendUrl}/quote" style="background:#1B4332;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">
              Request New Quote
            </a>
          </p>
          <p>— The Shadesology Team</p>
        `,
        text: `Your quote ${quote.referenceNumber} has expired. View it at ${trackingUrl}. Visit ${frontendUrl}/quote to submit a new request.`,
      });
    }

    job.log(`Expired quote ${quote.referenceNumber}`);
  }

  return { expired: staleQuotes.length };
}

async function sendFollowUpReminders(job) {
  job.log('Running send-followup-reminders');
  const now         = new Date();
  const frontendUrl = process.env.FRONTEND_URL || 'https://shadesology.com';

  // Quotes in 'quoted' status where expiry is within FOLLOWUP_DAYS and no reminder sent yet
  const followupWindow = new Date(now.getTime() + FOLLOWUP_DAYS * 24 * 60 * 60 * 1000);

  const quotesToFollow = await Quote.find({
    status:         'quoted',
    expiresAt:      { $gt: now, $lte: followupWindow },
    followUpSentAt: null,
  })
    .populate('user', 'firstName lastName email')
    .lean();

  job.log(`Found ${quotesToFollow.length} quote(s) needing follow-up reminders.`);

  for (const quote of quotesToFollow) {
    const contactEmail = quote.guestContact?.email || quote.user?.email;
    const contactName  = quote.guestContact?.firstName || quote.user?.firstName || 'Customer';
    const daysLeft     = Math.ceil((new Date(quote.expiresAt) - now) / (24 * 60 * 60 * 1000));
    const expiryStr    = new Date(quote.expiresAt).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const token = await createGuestStatusToken(quote);
    const trackingUrl = statusUrl(quote, frontendUrl, token);

    if (contactEmail) {
      enqueueEmail({
        to:      contactEmail,
        subject: `Your Shadesology quote ${quote.referenceNumber} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
        html: `
          <h2 style="color:#1B4332">Quote Expiring Soon</h2>
          <p>Hi ${contactName},</p>
          <p>Your quote <strong>${quote.referenceNumber}</strong> expires on <strong>${expiryStr}</strong> (${daysLeft} day${daysLeft !== 1 ? 's' : ''} from now).</p>
          <p>Prices are locked at the quoted amount until then. After expiry, you will need to request a new quote, which may reflect updated material costs.</p>
          <p>
            <a href="${trackingUrl}" style="background:#1B4332;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">
              View Your Quote
            </a>
          </p>
          <p>Questions? Reply to this email or call us — we are happy to help.</p>
          <p>— The Shadesology Team</p>
        `,
        text: `Your quote ${quote.referenceNumber} expires on ${expiryStr}. Visit ${trackingUrl} to view your quote.`,
      });
    }

    // Mark as sent — prevents duplicate reminders
    await Quote.findByIdAndUpdate(quote._id, { followUpSentAt: now });
    job.log(`Follow-up sent for quote ${quote.referenceNumber}`);
  }

  return { reminders: quotesToFollow.length };
}

// ─── Scheduler lifecycle ──────────────────────────────────────────────────────

let _schedulerQueue = null;
let _worker         = null;

/**
 * Start the quote scheduler.
 * Registers two repeating jobs (hourly) and a worker to process them.
 * Safe to call multiple times — re-registers only if not already running.
 */
async function start() {
  if (!isRedisEnabled()) {
    console.info('[QuoteScheduler] Redis disabled — scheduler not started.');
    return;
  }

  const conn = createRedisConnection();
  if (!conn) return;

  // Use a dedicated queue for scheduler jobs so they don't mix with PDF jobs
  _schedulerQueue = new Queue('quote-scheduler', {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts:         1,
      removeOnComplete: { count: 10 },
      removeOnFail:     { count: 50 },
    },
  });

  _schedulerQueue.on('error', () => {});

  // Register repeating jobs — BullMQ de-dupes by jobId so this is safe to call on every startup
  await _schedulerQueue.upsertJobScheduler(
    'expire-stale-quotes',
    { every: 60 * 60 * 1000 }, // every 1 hour
    { name: 'expire-stale-quotes', data: {} }
  );

  await _schedulerQueue.upsertJobScheduler(
    'send-followup-reminders',
    { every: 60 * 60 * 1000 }, // every 1 hour
    { name: 'send-followup-reminders', data: {} }
  );

  // Worker
  _worker = new Worker(
    'quote-scheduler',
    async (job) => {
      if (job.name === 'expire-stale-quotes')     return expireStaleQuotes(job);
      if (job.name === 'send-followup-reminders') return sendFollowUpReminders(job);
      throw new Error(`Unknown scheduler job: ${job.name}`);
    },
    { connection: conn, concurrency: 1 }
  );

  _worker.on('completed', (job) => {
    console.info(`[QuoteScheduler] ✅ ${job.name} done — ${JSON.stringify(job.returnvalue)}`);
  });
  _worker.on('failed', (job, err) => {
    console.error(`[QuoteScheduler] ❌ ${job?.name} failed: ${err.message}`);
  });
  _worker.on('error', () => {});

  console.info('[QuoteScheduler] started — expiry + follow-up reminders running hourly.');
}

async function stop() {
  if (_worker)         { await _worker.close(); _worker = null; }
  if (_schedulerQueue) { await _schedulerQueue.close(); _schedulerQueue = null; }
  console.info('[QuoteScheduler] stopped.');
}

module.exports = { start, stop };
