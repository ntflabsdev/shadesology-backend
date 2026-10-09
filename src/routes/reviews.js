'use strict';

const express = require('express');
const { optionalAuthenticate } = require('../middlewares/authenticate');
const rateLimit = require('../middlewares/rateLimit');
const { listReviews, submitReview, markHelpful } = require('../controllers/review/reviewController');

const router = express.Router();

/**
 * GET  /api/reviews?productId=xxx  — list approved reviews for a product
 * POST /api/reviews                — submit a new review
 * POST /api/reviews/:id/helpful    — mark a review as helpful
 */

router.get(
  '/',
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'rl:reviews-list' }),
  listReviews
);

router.post(
  '/',
  rateLimit({ windowMs: 10 * 60_000, max: 3, keyPrefix: 'rl:review-submit' }),
  optionalAuthenticate,
  submitReview
);

router.post(
  '/:id/helpful',
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:review-helpful' }),
  markHelpful
);

module.exports = router;
