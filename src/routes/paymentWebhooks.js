'use strict';

const express = require('express');
const { handleStripeWebhook } = require('../controllers/paymentController');
const { handleHubSpotWebhook } = require('../controllers/hubspotWebhookController');

const router = express.Router();
router.post('/stripe', express.raw({ type: 'application/json', limit: '1mb' }), handleStripeWebhook);
router.post('/hubspot', express.raw({ type: 'application/json', limit: '1mb' }), handleHubSpotWebhook);

module.exports = router;
