/**
 * Generic CRUD controller factory for admin resources.
 *
 * Creates list, getOne, create, update, remove handlers for any Mongoose model.
 * The admin shell calls this once per resource — no duplicate controller code.
 *
 * Usage:
 *   const handlers = makeCrudController(ProductType, { searchFields: ['name.en', 'code'] });
 *   router.get('/',    handlers.list);
 *   router.get('/:id', handlers.getOne);
 *   router.post('/',   handlers.create);
 *   router.put('/:id', handlers.update);
 *   router.delete('/:id', handlers.remove);
 */

const mongoose = require('mongoose');
const { createError } = require('../../middlewares/errorHandler');

/**
 * @param {mongoose.Model} Model       - Mongoose model to operate on
 * @param {Object}         options
 * @param {string[]}       options.searchFields  - Fields to search with $regex
 * @param {string[]}       options.populateFields - Fields to populate on getOne
 * @param {string}         options.defaultSort   - Default sort e.g. 'sortOrder name.en'
 */
const makeCrudController = (Model, options = {}) => {
  const {
    searchFields = [],
    populateFields = [],
    defaultSort = 'sortOrder createdAt',
  } = options;

  // ── LIST ───────────────────────────────────────────────────────────────────
  const list = async (req, res, next) => {
    try {
      const {
        page = 1,
        limit = 25,
        sort = defaultSort,
        search = '',
        isActive,
      } = req.query;

      const filter = {};

      // Optional isActive filter
      if (isActive !== undefined) {
        filter.isActive = isActive === 'true';
      }

      // Text search across searchFields
      if (search && searchFields.length > 0) {
        filter.$or = searchFields.map((field) => ({
          [field]: { $regex: search, $options: 'i' },
        }));
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [docs, total] = await Promise.all([
        Model.find(filter).sort(sort).skip(skip).limit(limitNum).lean(),
        Model.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: docs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  // ── GET ONE ────────────────────────────────────────────────────────────────
  const getOne = async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return next(createError(400, 'Invalid ID format.'));
      }

      let query = Model.findById(req.params.id);
      for (const field of populateFields) {
        query = query.populate(field);
      }

      const doc = await query.lean();
      if (!doc) {
        return next(createError(404, `${Model.modelName} not found.`));
      }

      res.json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  };

  // ── CREATE ─────────────────────────────────────────────────────────────────
  const create = async (req, res, next) => {
    try {
      const doc = await Model.create(req.body);
      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  };

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  const update = async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return next(createError(400, 'Invalid ID format.'));
      }

      const doc = await Model.findByIdAndUpdate(
        req.params.id,
        { $set: req.body },
        { new: true, runValidators: true }
      );

      if (!doc) {
        return next(createError(404, `${Model.modelName} not found.`));
      }

      res.json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  };

  // ── REMOVE ─────────────────────────────────────────────────────────────────
  const remove = async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return next(createError(400, 'Invalid ID format.'));
      }

      const doc = await Model.findByIdAndDelete(req.params.id);
      if (!doc) {
        return next(createError(404, `${Model.modelName} not found.`));
      }

      res.json({ success: true, message: `${Model.modelName} deleted.` });
    } catch (err) {
      next(err);
    }
  };

  // ── TOGGLE isActive ────────────────────────────────────────────────────────
  const toggleActive = async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return next(createError(400, 'Invalid ID format.'));
      }

      const doc = await Model.findById(req.params.id);
      if (!doc) {
        return next(createError(404, `${Model.modelName} not found.`));
      }

      doc.isActive = !doc.isActive;
      await doc.save();

      res.json({ success: true, data: { _id: doc._id, isActive: doc.isActive } });
    } catch (err) {
      next(err);
    }
  };

  return { list, getOne, create, update, remove, toggleActive };
};

module.exports = makeCrudController;
