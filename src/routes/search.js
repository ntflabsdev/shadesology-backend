const express = require('express');
const rateLimit = require('../middlewares/rateLimit');
const { typeahead, search, notFoundSuggestions } = require('../controllers/search/searchController');

const router = express.Router();

// Rate-limit search endpoints (Prompt 1.21 hardens these further)
// 60 requests per minute per IP
router.get('/typeahead',    rateLimit({ windowMs: 60_000, max: 60 }), typeahead);
router.get('/',             rateLimit({ windowMs: 60_000, max: 30 }), search);
router.get('/not-found',    rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'rl:search-not-found' }), notFoundSuggestions);

module.exports = router;
