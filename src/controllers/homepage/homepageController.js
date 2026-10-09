const HomepageSection = require('../../models/HomepageSection');
const { createError } = require('../../middlewares/errorHandler');
const {
  isPayloadEditorialSource,
  getGlobal,
  mapHomepage,
} = require('../../services/payloadPublicContent');

// ─── Public: get all active sections in order ────────────────────────────────
const getSections = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const sections = await getGlobal('homepage', mapHomepage);
      return res.json({ success: true, data: sections.filter((section) => section.isActive) });
    }

    const sections = await HomepageSection.find({ isActive: true })
      .sort('sortOrder')
      .populate('featuredProducts', 'name slug images basePrice showPrice productType')
      .lean();

    res.json({ success: true, data: sections });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: get ALL sections (active + inactive) ──────────────────────────────
const adminGetSections = async (req, res, next) => {
  try {
    const sections = await HomepageSection.find()
      .sort('sortOrder')
      .populate('featuredProducts', 'name slug images')
      .lean();

    res.json({ success: true, data: sections });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: create a new section ─────────────────────────────────────────────
const createSection = async (req, res, next) => {
  try {
    const section = await HomepageSection.create(req.body);
    res.status(201).json({ success: true, data: section });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: update a section ──────────────────────────────────────────────────
const updateSection = async (req, res, next) => {
  try {
    const section = await HomepageSection.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!section) return next(createError(404, 'Homepage section not found.'));
    res.json({ success: true, data: section });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: toggle isActive ────────────────────────────────────────────────────
const toggleSection = async (req, res, next) => {
  try {
    const section = await HomepageSection.findById(req.params.id);
    if (!section) return next(createError(404, 'Homepage section not found.'));
    section.isActive = !section.isActive;
    await section.save();
    res.json({ success: true, data: { _id: section._id, isActive: section.isActive } });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: bulk reorder sections ─────────────────────────────────────────────
/**
 * Expects body: { order: [ { id: '...', sortOrder: 0 }, ... ] }
 * Updates sortOrder for each section in one bulk write.
 */
const reorderSections = async (req, res, next) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) {
      return next(createError(400, 'order must be a non-empty array of { id, sortOrder }.'));
    }

    const bulkOps = order.map(({ id, sortOrder }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sortOrder: Number(sortOrder) } },
      },
    }));

    await HomepageSection.bulkWrite(bulkOps);

    const sections = await HomepageSection.find().sort('sortOrder').lean();
    res.json({ success: true, data: sections });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: delete a section ──────────────────────────────────────────────────
const deleteSection = async (req, res, next) => {
  try {
    const section = await HomepageSection.findByIdAndDelete(req.params.id);
    if (!section) return next(createError(404, 'Homepage section not found.'));
    res.json({ success: true, message: 'Section deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSections,
  adminGetSections,
  createSection,
  updateSection,
  toggleSection,
  reorderSections,
  deleteSection,
};
