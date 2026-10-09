'use strict';

const express = require('express');
const { optionalAuthenticate } = require('../middlewares/authenticate');
const rateLimit = require('../middlewares/rateLimit');
const {
  serveDocument,
  requestDocument,
  listDocuments,
} = require('../controllers/download/downloadController');

const router = express.Router();

/**
 * GET  /api/downloads             — list available documents (public)
 * GET  /api/downloads/:id         — serve/gate a document (optionalAuthenticate)
 * POST /api/downloads/:id/request — email-capture for gated docs (public)
 */

router.get(
  '/',
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'rl:downloads-list' }),
  listDocuments
);

router.get(
  '/:id',
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'rl:download-serve' }),
  optionalAuthenticate,
  serveDocument
);

router.post(
  '/:id/request',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:download-request' }),
  optionalAuthenticate,
  requestDocument
);

module.exports = router;
