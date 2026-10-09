'use strict';

/**
 * Queue registry — central place to get a named BullMQ Queue instance.
 *
 * When REDIS_ENABLED=false (or Redis is not running), getQueue() returns a
 * no-op stub so callers don't need to null-check. Jobs are silently dropped
 * in dev; in production Redis must be available.
 *
 * Defined queues:
 *   'email'    — transactional SES email jobs
 *   'crm-sync' — HubSpot sync jobs
 *   'crm-dead-letter' — exhausted CRM sync jobs
 *   'import'   — catalog import jobs (Prompt 1.10)
 *   'pdf'      — PDF generation jobs (Prompt 1.13)
 *
 * Usage:
 *   const { getQueue } = require('./index');
 *   getQueue('email').add('send', { to, subject, html }, { attempts: 5 });
 *   // Safe even when Redis is unavailable — the stub drops the job silently.
 */

const { Queue } = require('bullmq');
const { createRedisConnection, isRedisEnabled } = require('../config/redis');

const QUEUE_NAMES = ['email', 'crm-sync', 'crm-dead-letter', 'import', 'pdf', 'quote-scheduler', 'privacy'];

const _queues = {};

// ─── No-op stub used when Redis is disabled ───────────────────────────────────
const _noopQueue = {
  add:    async () => ({ id: 'noop' }),
  close:  async () => {},
  getJobCounts: async () => ({}),
};

/**
 * Get (or lazily create) a BullMQ Queue by name.
 * Returns a no-op stub if Redis is disabled.
 */
function getQueue(name) {
  if (!QUEUE_NAMES.includes(name)) {
    throw new Error(`Unknown queue "${name}". Valid: ${QUEUE_NAMES.join(', ')}`);
  }

  // Return stub if Redis is disabled
  if (!isRedisEnabled()) {return _noopQueue;}

  if (!_queues[name]) {
    const conn = createRedisConnection();
    if (!conn) {return _noopQueue;}

    _queues[name] = new Queue(name, {
      connection: conn,
      defaultJobOptions: {
        attempts: 5,
        backoff:  { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 500 },
      },
    });

    // Suppress queue-level Redis errors (already handled at connection level)
    _queues[name].on('error', () => {});

    console.info(`[Queue] "${name}" ready.`);
  }

  return _queues[name];
}

async function closeAll() {
  if (!isRedisEnabled()) {return;}
  await Promise.all(Object.values(_queues).map((q) => q.close().catch(() => {})));
}

module.exports = { getQueue, closeAll, QUEUE_NAMES };
