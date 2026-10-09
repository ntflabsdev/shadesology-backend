'use strict';

/**
 * Email Worker — processes jobs from the 'email' BullMQ queue.
 *
 * Requires Redis. If REDIS_ENABLED=false or Redis is unavailable at startup,
 * the worker is not started and emails are silently skipped (acceptable in dev).
 *
 * In production, Redis must be running — emails are queued with retry (5 attempts,
 * exponential backoff). A failed job stays in the 'failed' set for inspection.
 *
 * Enqueue from anywhere:
 *   const { getQueue } = require('../queues');
 *   getQueue('email')?.add('send', { to, subject, html, text }, { attempts: 5 });
 */

const { Worker } = require('bullmq');
const { createRedisConnection, isRedisEnabled } = require('../config/redis');
const emailSvc = require('../services/email');

let _worker = null;

async function processor(job) {
  const { to, subject, html, text, from, replyTo, cc, bcc } = job.data;

  if (!to || !subject || !html) {
    throw new Error('Email job missing required fields: to, subject, html');
  }

  job.log(`Sending email to ${Array.isArray(to) ? to.join(', ') : to}`);

  const result = await emailSvc.send({ to, subject, html, text, from, replyTo, cc, bcc });
  job.log(`Sent — messageId: ${result.messageId}`);
  return { messageId: result.messageId };
}

function start() {
  if (_worker) return _worker;

  if (!isRedisEnabled()) {
    console.info('[EmailWorker] Redis disabled — email worker not started. Emails will be skipped in dev.');
    return null;
  }

  const conn = createRedisConnection();
  if (!conn) return null;

  _worker = new Worker('email', processor, {
    connection:  conn,
    concurrency: 5,
  });

  _worker.on('completed', (job) => {
    console.info(`[EmailWorker] ✅ job ${job.id} sent — ${job.returnvalue?.messageId}`);
  });

  _worker.on('failed', (job, err) => {
    console.error(`[EmailWorker] ❌ job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });

  // Only log worker-level errors once, not on every retry
  let _workerErrLogged = false;
  _worker.on('error', (err) => {
    if (!_workerErrLogged) {
      console.warn('[EmailWorker] Redis not available — email sending paused until Redis connects.');
      _workerErrLogged = true;
    }
  });

  console.info('[EmailWorker] started (concurrency: 5)');
  return _worker;
}

async function stop() {
  if (_worker) {
    await _worker.close();
    _worker = null;
    console.info('[EmailWorker] stopped.');
  }
}

module.exports = { start, stop };
