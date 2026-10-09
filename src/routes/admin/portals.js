'use strict';

const express = require('express');
const mongoose = require('mongoose');
const Company = require('../../models/Company');
const User = require('../../models/User');
const DealerWarrantyClaim = require('../../models/DealerWarrantyClaim');
const { createError } = require('../../middlewares/errorHandler');
const s3 = require('../../services/s3');
const { requireStaffRole } = require('../../middlewares/requireRole');
const AuditLog = require('../../models/AuditLog');

const router = express.Router();
const COMPANY_STAFF = ['admin', 'sales'];
const CLAIM_STAFF = ['admin', 'sales', 'support'];

router.get('/companies', requireStaffRole(...COMPANY_STAFF), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = {};
    if (['dealer', 'specifier', 'installer', 'commercial_customer', 'other'].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    if (['true', 'false'].includes(req.query.isApproved)) {
      filter.isApproved = req.query.isApproved === 'true';
    }
    const [companies, total] = await Promise.all([
      Company.find(filter).populate('companyAdmin', 'firstName lastName email').sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      Company.countDocuments(filter),
    ]);
    res.json({ success: true, data: companies, pagination: { page, limit, total } });
  } catch (error) {
    next(error);
  }
});

router.get('/audit', requireStaffRole('admin'), async (req, res, next) => {
  try {
    const filter = {};
    if (['document_accessed', 'pricing_viewed', 'pricing_group_set', 'role_changed', 'company_updated', 'dealer_claim_updated'].includes(req.query.event)) {
      filter.event = req.query.event;
    }
    const logs = await AuditLog.find(filter)
      .populate('actor', 'firstName lastName email')
      .populate('subject', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, Number(req.query.limit) || 100)))
      .lean();
    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
});

router.patch('/companies/:id', requireStaffRole(...COMPANY_STAFF), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {return next(createError(400, 'Invalid company ID.'));}
    const allowed = new Set(['isActive', 'creditLimit', 'paymentTerms']);
    const entries = Object.entries(req.body || {});
    if (!entries.length || entries.some(([key]) => !allowed.has(key))) {
      return next(createError(400, 'Only isActive, creditLimit, and paymentTerms may be updated.'));
    }
    if (req.body.isActive !== undefined && typeof req.body.isActive !== 'boolean') {
      return next(createError(400, 'isActive must be a boolean.'));
    }
    if (req.body.creditLimit !== undefined && (!Number.isFinite(req.body.creditLimit) || req.body.creditLimit < 0)) {
      return next(createError(400, 'creditLimit must be a non-negative amount.'));
    }
    if (req.body.paymentTerms !== undefined && !['prepay', 'net15', 'net30', 'net45', 'net60'].includes(req.body.paymentTerms)) {
      return next(createError(400, 'paymentTerms must be prepay, net15, net30, net45, or net60.'));
    }
    const company = await Company.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!company) {return next(createError(404, 'Company not found.'));}
    await AuditLog.record({
      event: 'company_updated',
      actor: req.user._id,
      actorEmail: req.user.email,
      meta: { companyId: String(company._id), changes: req.body },
      ip: req.ip,
    });
    res.json({ success: true, data: company });
  } catch (error) {
    next(error);
  }
});

router.get('/claims', requireStaffRole(...CLAIM_STAFF), async (req, res, next) => {
  try {
    const filter = {};
    if (['submitted', 'in_review', 'approved', 'declined', 'resolved'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const claims = await DealerWarrantyClaim.find(filter)
      .populate('company', 'name type')
      .populate('user', 'firstName lastName email')
      .populate('order', 'orderNumber status')
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: claims });
  } catch (error) {
    next(error);
  }
});

router.get('/claims/:id/photos/:photoIndex/url', requireStaffRole(...CLAIM_STAFF), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !/^\d+$/.test(req.params.photoIndex)) {
      return next(createError(400, 'Invalid claim or photo ID.'));
    }
    const claim = await DealerWarrantyClaim.findById(req.params.id).select('photos');
    const photo = claim?.photos[Number(req.params.photoIndex)];
    if (!photo || !photo.key || /^https?:\/\//i.test(photo.key)) {return next(createError(404, 'Warranty photo not found.'));}
    const file = await s3.headFile(photo.key, 'private');
    if (!file.exists) {return next(createError(404, 'Warranty photo is no longer available.'));}
    res.json({
      success: true,
      data: {
        downloadUrl: await s3.getSignedDownloadUrl(photo.key, 'private', 300),
        expiresIn: 300,
        filename: photo.filename,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/claims/:id', requireStaffRole(...CLAIM_STAFF), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) ||
      !['in_review', 'approved', 'declined', 'resolved'].includes(req.body?.status)) {
      return next(createError(400, 'A valid claim ID and status are required.'));
    }
    const claim = await DealerWarrantyClaim.findById(req.params.id);
    if (!claim) {return next(createError(404, 'Warranty claim not found.'));}
    claim.status = req.body.status;
    claim.resolution = typeof req.body.resolution === 'string' ? req.body.resolution.trim().slice(0, 2000) : '';
    claim.resolvedBy = req.user._id;
    claim.resolvedAt = new Date();
    await claim.save();
    await AuditLog.record({
      event: 'dealer_claim_updated',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: claim.user,
      meta: { claimId: String(claim._id), status: claim.status },
      ip: req.ip,
    });
    res.json({ success: true, data: { _id: claim._id, status: claim.status, resolution: claim.resolution } });
  } catch (error) {
    next(error);
  }
});

router.get('/companies/:id/members', requireStaffRole(...COMPANY_STAFF), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {return next(createError(400, 'Invalid company ID.'));}
    const members = await User.find({ company: req.params.id })
      .select('firstName lastName email role isActive isCompanyAdmin pricingGroup lastLoginAt')
      .sort({ createdAt: 1 }).lean();
    res.json({ success: true, data: members });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
