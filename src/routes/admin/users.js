const express = require('express');
const mongoose = require('mongoose');
const makeCrudController = require('../../controllers/admin/crudController');
const User = require('../../models/User');
const Company = require('../../models/Company');
const Variant = require('../../models/Variant');
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
router.patch('/:id/toggle', requireStaffRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(createError(400, 'Invalid ID format.'));
    }
    const user = await User.findById(req.params.id);
    if (!user) {return next(createError(404, 'User not found.'));}
    user.isActive = !user.isActive;
    user.tokenVersion += 1;
    user.suspendedAt = user.isActive ? null : new Date();
    user.suspendedBy = user.isActive ? null : req.user._id;
    user.suspendReason = user.isActive ? '' : (typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '');
    await user.save({ validateBeforeSave: false });
    await AuditLog.record({
      event: 'staff_status_changed',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: user._id,
      subjectEmail: user.email,
      meta: { isActive: user.isActive, reason: user.suspendReason },
      ip: req.ip,
    });
    res.json({ success: true, data: { _id: user._id, isActive: user.isActive } });
  } catch (err) {
    next(err);
  }
});

// ─── Staff: set pricing group (ONLY allowed path for pricing group change) ────
router.patch('/:id/pricing-group', requireStaffRole('admin'), async (req, res, next) => {
  try {
    const { pricingGroup } = req.body;
    if (pricingGroup === undefined) {
      return next(createError(400, 'pricingGroup is required.'));
    }
    if (typeof pricingGroup !== 'string' || pricingGroup.length > 100) {
      return next(createError(400, 'pricingGroup must be a string of at most 100 characters.'));
    }
    if (pricingGroup && !(await Variant.distinct('priceTiers.tierKey')).includes(pricingGroup)) {
      return next(createError(400, 'The selected pricing group is not present in the catalog.'));
    }

    const user = await User.findById(req.params.id).select('+tokenVersion');
    if (!user) {
      return next(createError(404, 'User not found.'));
    }
    const previousPricingGroup = user.pricingGroup;
    user.pricingGroup = pricingGroup;
    user.tokenVersion += 1;
    await user.save({ validateBeforeSave: false });

    await AuditLog.record({
      event: 'pricing_group_set',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: user._id,
      subjectEmail: user.email,
      meta: { fromGroup: previousPricingGroup, pricingGroup },
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
    if (['dealer', 'specifier'].includes(role)) {
      const company = await Company.findOne({
        _id: user.company,
        type: role,
        isApproved: true,
        isActive: true,
      }).select('_id');
      if (!company) {
        return next(createError(409, `An approved ${role} company is required before assigning this role.`));
      }
    }

    const previousRole = user.role;
    user.role = role;
    user.staffRole = role === 'staff' ? staffRole : '';
    user.tokenVersion += 1;
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
