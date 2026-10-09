const express = require('express');
const mongoose = require('mongoose');
const makeCrudController = require('../../controllers/admin/crudController');
const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const { createError } = require('../../middlewares/errorHandler');
const { requireStaffRole } = require('../../middlewares/requireRole');

const router = express.Router();
router.use(requireStaffRole('admin'));
const USER_PROFILE_FIELDS = new Set(['firstName', 'lastName', 'phone', 'locale', 'units', 'currency']);
const ctrl = makeCrudController(User, {
  searchFields: ['firstName', 'lastName', 'email'],
  populateFields: ['company'],
  defaultSort: '-createdAt',
});

router.get('/',     ctrl.list);
router.get('/:id',  ctrl.getOne);
router.put('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(createError(400, 'Invalid ID format.'));
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next(createError(400, 'A profile update object is required.'));
    }

    const fields = Object.keys(req.body);
    if (fields.length === 0 || fields.some((field) => !USER_PROFILE_FIELDS.has(field))) {
      return next(createError(400, 'Only firstName, lastName, phone, locale, units, and currency may be updated.'));
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!user) {
      return next(createError(404, 'User not found.'));
    }

    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});
// No POST — users self-register. No DELETE — use isActive toggle.
router.patch('/:id/toggle', requireStaffRole('admin'), ctrl.toggleActive);

// ─── Staff: set pricing group (ONLY allowed path for pricing group change) ────
router.patch('/:id/pricing-group', requireStaffRole('admin'), async (req, res, next) => {
  try {
    const { pricingGroup } = req.body;
    if (pricingGroup === undefined) {
      return next(createError(400, 'pricingGroup is required.'));
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { pricingGroup } },
      { new: true }
    );
    if (!user) {
      return next(createError(404, 'User not found.'));
    }

    await AuditLog.record({
      event: 'pricing_group_set',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: user._id,
      subjectEmail: user.email,
      meta: { pricingGroup },
      ip: req.ip,
    });

    res.json({ success: true, data: { _id: user._id, pricingGroup: user.pricingGroup } });
  } catch (err) {
    next(err);
  }
});

// ─── Staff: change role ───────────────────────────────────────────────────────
router.patch('/:id/role', requireStaffRole('admin'), async (req, res, next) => {
  try {
    const { role, staffRole } = req.body;
    const validRoles = ['customer', 'installer', 'specifier', 'dealer', 'staff'];
    const validStaffRoles = ['admin', 'sales', 'support', 'content'];

    if (!role || !validRoles.includes(role)) {
      return next(createError(400, `role must be one of: ${validRoles.join(', ')}`));
    }
    if (
      (role === 'staff' && !validStaffRoles.includes(staffRole))
      || (role !== 'staff' && staffRole !== undefined && staffRole !== '')
    ) {
      return next(createError(400, 'staffRole must be admin, sales, support, content, or empty for non-staff users.'));
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return next(createError(404, 'User not found.'));
    }

    const previousRole = user.role;
    user.role = role;
    user.staffRole = role === 'staff' ? staffRole : '';
    await user.save({ validateBeforeSave: false });

    await AuditLog.record({
      event: 'role_changed',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: user._id,
      subjectEmail: user.email,
      meta: { fromRole: previousRole, toRole: role },
      ip: req.ip,
    });

    res.json({ success: true, data: { _id: user._id, role: user.role } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
