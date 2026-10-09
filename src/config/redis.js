'use strict';

/**
 * Redis connection factory for BullMQ and general use.
 *
 * DEV WITHOUT REDIS:
 *   Set REDIS_ENABLED=false in .env to disable Redis entirely.
 *   All queue operations become no-ops, rate limiting falls back to in-memory.
 *   The server will start and run normally without Redis.
 *
 * PRODUCTION:
 *   Redis is required. Set REDIS_URL to your Redis instance URL.
 *   Remove REDIS_ENABLED or set it to true.
 */

const { Redis } = require('ioredis');

const REDIS_URL     = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

// Track whether we've already warned about Redis being down — avoid spam
let _warnedDown   = false;
let _warnedShared = false;

/**
 * Create a new ioredis connection for BullMQ.
 * Returns null if REDIS_ENABLED=false.
 *
 * Each Queue and Worker needs its own connection instance.
 */
function createRedisConnection() {
  if (!REDIS_ENABLED) return null;

  const conn = new Redis(REDIS_URL, {
    maxRetriesPerRequest:    null,   // required by BullMQ
    enableReadyCheck:        false,
    lazyConnect:             true,
    retryStrategy:           (times) => Math.min(times * 500, 10_000), // cap at 10s
  });

  conn.on('error', (err) => {
    if (!_warnedDown) {
      console.warn('[Redis] Not connected — queue jobs will be held until Redis is available.');
      console.warn('[Redis] Tip: run `brew services start redis` or set REDIS_ENABLED=false in .env to suppress this.');
      _warnedDown = true;
    }
  });

  conn.on('connect', () => {
    _warnedDown = false; // reset so we log on next disconnect
    console.info('[Redis] connected ✅');
  });

  return conn;
}

/** Shared connection for rate limiting, caching, etc. */
let _shared = null;

function getSharedConnection() {
  if (!REDIS_ENABLED) return null;
  if (_shared) return _shared;

  _shared = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect:          true,
    retryStrategy:        (times) => Math.min(times * 1000, 30_000),
  });

  _shared.on('error', () => {
    if (!_warnedShared) {
      console.warn('[Redis] Shared connection unavailable — using in-memory fallback for rate limiting.');
      _warnedShared = true;
    }
  });

  _shared.on('connect', () => {
    _warnedShared = false;
    console.info('[Redis] Shared connection ready ✅');
  });

  return _shared;
}

/** True if Redis is configured and expected to be available */
function isRedisEnabled() {
  return REDIS_ENABLED;
}

module.exports = { createRedisConnection, getSharedConnection, isRedisEnabled };
