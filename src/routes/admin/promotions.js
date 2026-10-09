'use strict';

/**
 * Admin Promotions router — /admin/promotions
 *
 * Staff can create, update, toggle and delete coupon / promo codes.
 * Uses the generic CRUD controller for standard operations and adds
 * a dedicated usage-reset endpoint.
 */

const express   = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Promotion = require('../../models/Promotion');
const { createError } = require('../../middlewares/errorHandler');

const router = express.Router();
const ctrl   = makeCrudController(Promotion, {
  searchFields: ['name', 'code'],
  defaultSort:  '-createdAt',
});

router.get('/',             ctrl.list);
router.get('/:id',          ctrl.getOne);
router.post('/',            ctrl.create);
router.put('/:id',          ctrl.update);
router.patch('/:id/toggle', ctrl.toggleActive);
router.delete('/:id',       ctrl.remove);

// ─── PATCH /admin/promotions/:id/reset-usage — Reset usedCount to 0 ─────────
router.patch('/:id/reset-usage', async (req, res, next) => {
  try {
    const promo = await Promotion.findByIdAndUpdate(
      req.params.id,
      { $set: { usedCount: 0 } },
      { new: true }
    );
    if (!promo) return next(createError(404, 'Promotion not found.'));
    res.json({ success: true, data: promo });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
