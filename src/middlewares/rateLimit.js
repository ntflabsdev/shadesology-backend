'use strict';

/**
 * Rate limiter middleware — Redis-backed sliding window with in-memory fallback.
 *
 * When Redis is available (REDIS_URL / RATE_LIMIT_REDIS_URL is set and reachable)
 * the limiter uses an atomic Lua-script sliding window stored in Redis so it
 * works correctly across multiple API instances.
 *
 * When Redis is unavailable, development/tests use an in-memory fallback.
 * Production fails closed with HTTP 503 so rate limits are never silently disabled.
 *
 * Usage:
 *   const rateLimit = require('../middlewares/rateLimit');
 *   router.get('/search',   rateLimit({ windowMs: 60_000, max: 30 }), handler);
 *   router.post('/contact', rateLimit({ windowMs: 60_000, max: 10 }), handler);
 */

// ─── In-memory fallback ──────────────────────────────────────────────────────

const inMemoryStore = new Map(); // key -> { count, resetAt }

function inMemoryLimit({ key, windowMs, max }) {
  const now = Date.now();
  let entry = inMemoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    inMemoryStore.set(key, entry);
  }

  entry.count += 1;
  return {
    count:      entry.count,
    remaining:  Math.max(0, max - entry.count),
    resetAt:    entry.resetAt,
    exceeded:   entry.count > max,
  };
}

// Clean up in-memory store every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of inMemoryStore.entries()) {
    if (now > v.resetAt) {
      inMemoryStore.delete(k);
    }
  }
}, 5 * 60_000).unref(); // .unref() so it doesn't keep the process alive

// ─── Redis sliding-window (Lua atomic) ──────────────────────────────────────

const LUA_SCRIPT = `
local key       = KEYS[1]
local window_ms = tonumber(ARGV[1])
local now       = tonumber(ARGV[2])
local max       = tonumber(ARGV[3])
local window_s  = window_ms / 1000

-- Remove entries outside the current window
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window_ms)

-- Count current entries
local count = redis.call('ZCARD', key)

-- Add current request (score = timestamp, member = timestamp+random)
redis.call('ZADD', key, now, now .. ':' .. math.random(1, 1000000))

-- Set TTL
redis.call('EXPIRE', key, math.ceil(window_s) + 1)

return count + 1
`;

let _redisClient = null;
let _redisAvailable = null; // null = untested, true/false = known state
let _redisRetryAt = 0;

async function getRedisClient() {
  if (_redisClient) {
    return _redisClient;
  }
  if (_redisAvailable === false && Date.now() < _redisRetryAt) {
    return null;
  }

  try {
    const { getSharedConnection } = require('../config/redis');
    const conn = getSharedConnection();
    // Quick connectivity check
    await conn.ping();
    _redisClient    = conn;
    _redisAvailable = true;
    _redisRetryAt   = 0;
    return _redisClient;
  } catch (err) {
    _redisAvailable = false;
    _redisRetryAt = Date.now() + 5_000;
    console.error('[RateLimit] Redis unavailable:', err.message);
    return null;
  }
}

async function redisLimit({ key, windowMs, max }) {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const now   = Date.now();
    const count = await client.eval(LUA_SCRIPT, 1, key, windowMs, now, max);
    return {
      count:    count,
      remaining: Math.max(0, max - count),
      resetAt:  now + windowMs,
      exceeded: count > max,
    };
  } catch (err) {
    _redisAvailable = false;
    _redisRetryAt = Date.now() + 5_000;
    console.error('[RateLimit] Redis request failed:', err.message);
    return null; // Redis error → fall back
  }
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * @param {object} options
 * @param {number} [options.windowMs=60000]  Time window in ms
 * @param {number} [options.max=60]          Max requests per window per IP
 * @param {string} [options.message]         Custom error message
 * @param {string} [options.keyPrefix]       Prefix for the Redis key (default 'rl')
 * @param {(req: import('express').Request) => string} [options.keyGenerator] Custom key suffix
 */
const rateLimit = ({ windowMs = 60_000, max = 60, message, keyPrefix = 'rl', keyGenerator } = {}) => {
  return async (req, res, next) => {
    const ip  = req.ip || req.socket.remoteAddress || 'unknown';
    const keySuffix = keyGenerator ? keyGenerator(req) : ip;
    const key = `${keyPrefix}:${keySuffix}`;

    // Try Redis first, fall back to in-memory
    let result = await redisLimit({ key, windowMs, max });
    if (!result) {
      if (process.env.NODE_ENV === 'production') {
        res.set('Retry-After', '5');
        return res.status(503).json({
          success: false,
          message: 'Request protection is temporarily unavailable. Please try again shortly.',
        });
      }
      result = inMemoryLimit({ key, windowMs, max });
    }

    // Set standard rate-limit response headers
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    res.set('X-RateLimit-Limit',     String(max));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    res.set('X-RateLimit-Reset',     String(Math.ceil(result.resetAt / 1000)));

    if (result.exceeded) {
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        success: false,
        message: message || 'Too many requests. Please try again shortly.',
        retryAfter,
      });
    }

    next();
  };
};

module.exports = rateLimit;
