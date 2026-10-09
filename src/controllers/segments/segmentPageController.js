const SegmentPage = require('../../models/SegmentPage');
const Segment = require('../../models/Segment');
const { createError } = require('../../middlewares/errorHandler');
const {
  isPayloadEditorialSource,
  getPublishedCollection,
  mapSegment,
  mapSegmentPage,
  publishedReadFilter,
} = require('../../services/payloadPublicContent');

// ─── Public: get a segment page by slug ──────────────────────────────────────
const getBySlug = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const { docs } = await getPublishedCollection('segment-pages', { limit: 100 });
      const page = docs.find((doc) => doc.slug === req.params.slug && doc.isActive !== false);
      if (!page) {
        return next(createError(404, 'Segment page not found.'));
      }
      return res.json({ success: true, data: mapSegmentPage(page) });
    }

    const page = await SegmentPage.findOne(publishedReadFilter({
      slug: req.params.slug,
      status: 'published',
      isActive: true,
    }))
      .populate('segment', 'name code audience icon')
      .populate('featuredProducts', 'name slug images showPrice productType category')
      .populate('featuredProjects', 'title slug images location segments')
      .populate('relatedSegments', 'name slug')
      .lean();

    if (!page) return next(createError(404, 'Segment page not found.'));

    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
};

// ─── Public: list all published segment pages ─────────────────────────────────
const listPublished = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const [{ docs: pages }, { docs: segments }] = await Promise.all([
        getPublishedCollection('segment-pages', { limit: 100 }),
        getPublishedCollection('segments', { limit: 100 }),
      ]);
      const segmentById = new Map(segments.map((segment) => [String(segment.id || segment._id), segment]));
      const published = pages
        .filter((page) => page.isActive !== false)
        .map((page) => {
          const relation = typeof page.segment === 'object'
            ? page.segment
            : segmentById.get(String(page.segment));
          return relation && relation.isActive !== false
            ? { ...page, segment: mapSegment(relation) }
            : null;
        })
        .filter((page) => page && (!req.query.audience || page.segment.audience === req.query.audience))
        .map(mapSegmentPage);
      return res.json({ success: true, data: published, total: published.length });
    }

    const { audience } = req.query; // 'residential' | 'commercial'

    const segmentFilter = publishedReadFilter({ isActive: true });
    if (audience) segmentFilter.audience = audience;

    // Get matching segment IDs first
    const segments = await Segment.find(segmentFilter).select('_id').lean();
    const segmentIds = segments.map((s) => s._id);

    const pages = await SegmentPage.find(publishedReadFilter({
      segment: { $in: segmentIds },
      status: 'published',
      isActive: true,
    }))
      .populate('segment', 'name code audience icon sortOrder')
      .sort('segment.sortOrder')
      .lean();

    res.json({ success: true, data: pages, total: pages.length });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: list all segment pages (all statuses) ────────────────────────────
const adminList = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, parseInt(limit, 10));

    const [docs, total] = await Promise.all([
      SegmentPage.find(filter)
        .populate('segment', 'name code audience')
        .sort('slug')
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      SegmentPage.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: docs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: get one segment page by id ───────────────────────────────────────
const adminGetOne = async (req, res, next) => {
  try {
    const page = await SegmentPage.findById(req.params.id)
      .populate('segment')
      .populate('featuredProducts', 'name slug images')
      .populate('featuredProjects', 'title slug images')
      .lean();

    if (!page) return next(createError(404, 'Segment page not found.'));
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: update a segment page ────────────────────────────────────────────
const adminUpdate = async (req, res, next) => {
  try {
    // Prevent slug changes via update — slug is immutable (mirrors segment)
    delete req.body.slug;
    delete req.body.segment;

    const page = await SegmentPage.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate('segment', 'name code');

    if (!page) return next(createError(404, 'Segment page not found.'));
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: publish / unpublish ───────────────────────────────────────────────
const adminSetStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['draft', 'published'].includes(status)) {
      return next(createError(400, "status must be 'draft' or 'published'."));
    }

    const page = await SegmentPage.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!page) return next(createError(404, 'Segment page not found.'));
    res.json({ success: true, data: { _id: page._id, status: page.status } });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: add / update a content block ─────────────────────────────────────
const adminUpsertBlock = async (req, res, next) => {
  try {
    const page = await SegmentPage.findById(req.params.id);
    if (!page) return next(createError(404, 'Segment page not found.'));

    const { blockId } = req.params;

    if (blockId) {
      // Update existing block
      const block = page.contentBlocks.id(blockId);
      if (!block) return next(createError(404, 'Content block not found.'));
      Object.assign(block, req.body);
    } else {
      // Add new block
      page.contentBlocks.push(req.body);
    }

    await page.save();
    res.json({ success: true, data: page.contentBlocks });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: delete a content block ───────────────────────────────────────────
const adminDeleteBlock = async (req, res, next) => {
  try {
    const page = await SegmentPage.findById(req.params.id);
    if (!page) return next(createError(404, 'Segment page not found.'));

    const block = page.contentBlocks.id(req.params.blockId);
    if (!block) return next(createError(404, 'Content block not found.'));

    block.deleteOne();
    await page.save();
    res.json({ success: true, message: 'Block deleted.', data: page.contentBlocks });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: reorder content blocks ────────────────────────────────────────────
const adminReorderBlocks = async (req, res, next) => {
  try {
    const { order } = req.body; // [{ id, sortOrder }]
    if (!Array.isArray(order)) {
      return next(createError(400, 'order must be an array of { id, sortOrder }.'));
    }

    const page = await SegmentPage.findById(req.params.id);
    if (!page) return next(createError(404, 'Segment page not found.'));

    for (const { id, sortOrder } of order) {
      const block = page.contentBlocks.id(id);
      if (block) block.sortOrder = Number(sortOrder);
    }

    await page.save();
    res.json({ success: true, data: page.contentBlocks.sort((a, b) => a.sortOrder - b.sortOrder) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getBySlug,
  listPublished,
  adminList,
  adminGetOne,
  adminUpdate,
  adminSetStatus,
  adminUpsertBlock,
  adminDeleteBlock,
  adminReorderBlocks,
};
