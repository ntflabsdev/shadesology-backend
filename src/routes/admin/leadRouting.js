'use strict';

const express = require('express');
const mongoose = require('mongoose');
const LeadRoutingConfig = require('../../models/LeadRoutingConfig');
const Lead = require('../../models/Lead');
const { createError } = require('../../middlewares/errorHandler');
const s3 = require('../../services/s3');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPES = ['contact', 'quote', 'service_request', 'dealer', 'installer', 'commercial_lease', 'commercial_project', 'chat', 'warranty_registration'];

router.get('/:id/attachments/:index', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {return next(createError(400, 'Invalid lead ID.'));}
    const index = Number(req.params.index);
    const lead = await Lead.findById(req.params.id).select('attachments leadQueue').lean();
    if (!lead) {return next(createError(404, 'Lead not found.'));}
    if (!Number.isInteger(index) || index < 0 || index >= lead.attachments.length) {
      return next(createError(404, 'Lead attachment not found.'));
    }
    const attachment = lead.attachments[index];
    const domain = lead.leadQueue === 'commercial' ? 'commercial-projects' : 'service-requests';
    const prefix = `${process.env.NODE_ENV || 'development'}/${domain}/pending/`;
    if (!attachment.s3Key.startsWith(prefix)) {return next(createError(404, 'Lead attachment not found.'));}
    const url = await s3.getSignedDownloadUrl(attachment.s3Key, 'private', 300);
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
});

router.get('/routing', async (req, res, next) => {
  try {
    const config = await LeadRoutingConfig.findOne({ key: 'default' }).lean();
    res.json({ success: true, data: config?.rules || [] });
  } catch (err) {
    next(err);
  }
});

router.put('/routing', async (req, res, next) => {
  try {
    const rules = req.body?.rules;
    if (!Array.isArray(rules) || rules.length > 100) {return next(createError(400, 'rules must be an array of at most 100 entries.'));}
    const cleanRules = [];
    for (const [index, rule] of rules.entries()) {
      if (!rule || typeof rule !== 'object' || !EMAIL_RE.test(rule.notifyEmail || '')) {
        return next(createError(400, `Rule ${index + 1} requires a valid notification email.`));
      }
      if (rule.enquiryType && !TYPES.includes(rule.enquiryType)) {
        return next(createError(400, `Rule ${index + 1} has an unsupported enquiry type.`));
      }
      for (const key of ['productType', 'region']) {
        if (rule[key] !== undefined && (typeof rule[key] !== 'string' || rule[key].length > 100)) {
          return next(createError(400, `Rule ${index + 1} has an invalid ${key}.`));
        }
      }
      cleanRules.push({
        enquiryType: rule.enquiryType || '',
        productType: (rule.productType || '').trim(),
        region: (rule.region || '').trim(),
        notifyEmail: rule.notifyEmail.trim().toLowerCase(),
      });
    }
    const config = await LeadRoutingConfig.findOneAndUpdate(
      { key: 'default' }, { $set: { rules: cleanRules } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: config.rules });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = {};
    if (req.query.queue === 'commercial') {
      filter.leadQueue = 'commercial';
    } else if (req.query.queue === 'consumer') {
      filter.$or = [{ leadQueue: 'consumer' }, { leadQueue: { $exists: false } }];
    }
    if (req.query.type && TYPES.includes(req.query.type)) {filter.enquiryType = req.query.type;}
    if (req.query.status && ['new', 'assigned', 'contacted', 'closed'].includes(req.query.status)) {filter.status = req.query.status;}
    const [leads, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Lead.countDocuments(filter),
    ]);
    res.json({ success: true, data: leads, pagination: { page, limit, total } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
