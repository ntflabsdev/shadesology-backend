'use strict';

const express = require('express');
const rateLimit = require('../middlewares/rateLimit');
const {
  getFinancingOptions,
  createConsumerApplication,
  createLeaseApplication,
  getApplicationStatus,
  handleProviderCallback,
} = require('../controllers/financingController');

const router = express.Router();
router.get('/options', rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'rl:financing-options' }), getFinancingOptions);
router.post('/applications', rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'rl:financing-application' }), createConsumerApplication);
router.post('/lease-applications', rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'rl:lease-application' }), createLeaseApplication);
router.get('/applications/:reference', rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'rl:financing-status' }), getApplicationStatus);
router.post('/provider/callback', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'rl:financing-callback' }), handleProviderCallback);

module.exports = router;
