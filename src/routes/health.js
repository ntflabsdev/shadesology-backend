const express  = require('express');
const mongoose = require('mongoose');

const router = express.Router();

/**
 * GET /health
 * Returns server, database, SES, HubSpot and S3 status.
 * Used by load balancers, uptime monitors and docker-compose healthchecks.
 *
 * Adapter checks are async and done in parallel; they never crash the route
 * even if AWS/HubSpot credentials are not configured in dev.
 */
router.get('/', async (req, res) => {
  const dbState  = mongoose.connection.readyState;
  const dbStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || 'unknown';
  const dbOk     = dbState === 1;

  // ── Adapter health checks (non-blocking in dev) ────────────────────────────
  const [sesOk, hubspotResult] = await Promise.all([
    // SES
    (async () => {
      try {
        const emailSvc = require('../services/email');
        return await emailSvc.healthCheck();
      } catch {
        return false;
      }
    })(),
    // HubSpot
    (async () => {
      try {
        const hubspot = require('../services/hubspot');
        return await hubspot.healthCheck();
      } catch {
        return { healthy: false, error: 'not configured' };
      }
    })(),
  ]);

  // S3 — just validate config (no API call to avoid latency on every health ping)
  let s3Status = 'not_configured';
  if (process.env.S3_BUCKET_PUBLIC && process.env.S3_BUCKET_PRIVATE) {
    s3Status = 'configured';
  }

  const isHealthy = dbOk; // only DB is required for minimum viability

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    server:      'ok',
    database:    dbStatus,
    ses:         sesOk ? 'ok' : 'unavailable',
    hubspot:     hubspotResult?.healthy ? 'ok' : 'unavailable',
    hubspot_mode: process.env.HUBSPOT_MODE || 'sandbox',
    s3:          s3Status,
    ses_mode:    process.env.SES_MODE || 'sandbox',
    environment: process.env.NODE_ENV || 'development',
    timestamp:   new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

module.exports = router;
