const express = require('express');
const Segment  = require('../models/Segment');
const {
  isPayloadEditorialSource,
  getPublishedCollection,
  mapSegment,
} = require('../services/payloadPublicContent');
const {
  getBySlug,
  listPublished,
} = require('../controllers/segments/segmentPageController');

const router = express.Router();

// ─── Public ───────────────────────────────────────────────────────────────────
// GET /api/segments                   — list all published segment pages (for segment page routes)
// GET /api/segments/cards             — list Segment cards for homepage grid / nav
// GET /api/segments/:slug             — single segment page by slug

// Segment cards for the homepage grid and navigation
router.get('/cards', async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const { docs } = await getPublishedCollection('segments', { limit: 100 });
      const segments = docs
        .filter((segment) => (
          segment.isActive !== false &&
          (!req.query.audience || segment.audience === req.query.audience)
        ))
        .map(mapSegment)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return res.json({ success: true, data: segments });
    }

    const { audience } = req.query;
    const filter = { isActive: true };
    if (audience) filter.audience = audience;

    const segments = await Segment.find(filter)
      .select('name slug code audience icon heroImage sortOrder')
      .sort('sortOrder')
      .lean();

    res.json({ success: true, data: segments });
  } catch (err) {
    next(err);
  }
});

router.get('/',       listPublished);
router.get('/:slug',  getBySlug);

module.exports = router;
