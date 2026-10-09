const express = require('express');
const { getSections } = require('../controllers/homepage/homepageController');

const router = express.Router();

// ─── Public ───────────────────────────────────────────────────────────────────
// GET /api/homepage — returns all active sections in sortOrder
router.get('/', getSections);

module.exports = router;
