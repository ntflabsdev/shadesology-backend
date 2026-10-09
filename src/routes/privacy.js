'use strict';

const express = require('express');
const rateLimit = require('../middlewares/rateLimit');
const { optionalAuthenticate } = require('../middlewares/authenticate');
const { recordConsent, submitRequest, verifyRequest } = require('../controllers/privacyController');

const router = express.Router();
const privacyRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  keyPrefix: 'privacy',
  message: 'Too many privacy requests. Please try again later.',
});

router.post('/consent', optionalAuthenticate, privacyRateLimit, recordConsent);
router.post('/requests', privacyRateLimit, submitRequest);
router.post('/requests/verify', privacyRateLimit, verifyRequest);

module.exports = router;
