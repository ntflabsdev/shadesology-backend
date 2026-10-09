'use strict';

const express = require('express');
const {
  list,
  assign,
  approve,
  reject,
} = require('../../controllers/admin/approvalController');
const ApprovalRequest = require('../../models/ApprovalRequest');
const { createError } = require('../../middlewares/errorHandler');
const { revokeUserSessions } = require('../../controllers/auth/emailController');

const router = express.Router();

// ─── Staff-only approval management ──────────────────────────────────────────
// All routes here are already protected by requireStaff via admin/index.js

router.get('/',     list);

// GET /:id — individual application detail (was missing)
router.get('/:id',  async (req, res, next) => {
  try {
    const doc = await ApprovalRequest.findById(req.params.id)
      .populate('applicant', 'firstName lastName email role pricingGroup company createdAt')
      .populate('assignedTo', 'firstName lastName email staffRole')
      .populate('company',   'name type abn pricingGroup isApproved')
      .lean();

    if (!doc) return next(createError(404, 'Application not found.'));
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/assign',   assign);
router.patch('/:id/approve',  approve);
router.patch('/:id/reject',   reject);

// Session management
router.post('/users/:id/revoke-sessions', revokeUserSessions);

module.exports = router;
