'use strict';

const express = require('express');
const rateLimit = require('../middlewares/rateLimit');
const { getCheckoutSessionStatus } = require('../controllers/paymentController');

const router = express.Router();
router.get(
  '/session/:sessionId',
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:payment-status' }),
  getCheckoutSessionStatus
);

module.exports = router;
