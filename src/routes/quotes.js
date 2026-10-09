'use strict';

const express = require('express');
const { authenticate, optionalAuthenticate } = require('../middlewares/authenticate');
const rateLimit = require('../middlewares/rateLimit');
const {
  submitQuote,
  myQuotes,
  getMyQuote,
  guestGetQuote,
} = require('../controllers/quote/quoteController');
const { getPresignedUploadUrl } = require('../controllers/upload/uploadController');

const router = express.Router();

/**
 * POST /api/quotes                        — Submit a new quote request (guest or logged-in)
 * GET  /api/quotes/mine                   — List authenticated user's quotes
 * GET  /api/quotes/:id                    — Get a single quote (owner only)
 * GET  /api/quotes/status/:ref            — Guest status lookup (token in query)
 * POST /api/quotes/upload-url             — Get presigned S3 upload URL for attachments
 */

// Rate limit all quote submissions
router.post(
  '/',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:quote' }),
  optionalAuthenticate,
  (req, res, next) => {
    if (typeof req.body?.website === 'string' && req.body.website.trim()) {
      return res.status(202).json({ success: true, message: 'Quote request received.' });
    }
    next();
  },
  submitQuote
);

// Presigned upload URL — for drawing/photo attachments to quotes
// Rate-limited to prevent abuse
router.post(
  '/upload-url',
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:quote-upload' }),
  optionalAuthenticate,
  getPresignedUploadUrl
);

// Guest quote status — no auth required, token is in query string
router.get('/status/:ref', guestGetQuote);

// Authenticated customer routes
router.get('/mine', authenticate, myQuotes);
router.get('/:id',  authenticate, getMyQuote);

module.exports = router;
