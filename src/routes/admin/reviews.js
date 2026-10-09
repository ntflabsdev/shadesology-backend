const express = require('express');
const express_router = express.Router();
const makeCrudController = require('../../controllers/admin/crudController');
const Review = require('../../models/Review');
const { createError } = require('../../middlewares/errorHandler');

const ctrl = makeCrudController(Review, {
  searchFields: ['displayName', 'body', 'title'],
  populateFields: ['product', 'user'],
  defaultSort: '-createdAt',
});

express_router.get('/',              ctrl.list);
express_router.get('/:id',           ctrl.getOne);
express_router.post('/',             ctrl.create);
express_router.put('/:id',           ctrl.update);
express_router.delete('/:id',        ctrl.remove);

// ── Moderation shortcuts ────────────────────────────────────────────────────
express_router.patch('/:id/approve', async (req, res, next) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'approved', moderatedBy: req.user?._id, moderatedAt: new Date() } },
      { new: true }
    );
    if (!review) {
      return next(createError(404, 'Review not found.'));
    }
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

express_router.patch('/:id/reject', async (req, res, next) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: 'rejected',
          moderatedBy: req.user?._id,
          moderatedAt: new Date(),
          moderationNote: req.body.note || '',
        },
      },
      { new: true }
    );
    if (!review) {
      return next(createError(404, 'Review not found.'));
    }
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

module.exports = express_router;
