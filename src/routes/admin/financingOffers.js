'use strict';

const express = require('express');
const mongoose = require('mongoose');
const FinancingOffer = require('../../models/FinancingOffer');
const { createError } = require('../../middlewares/errorHandler');

const router = express.Router();
const allowedFields = [
  'name', 'offerType', 'apr', 'standardApr', 'termMonths', 'minimumAmount',
  'maximumAmount', 'startsAt', 'endsAt', 'lenderDisclosure', 'isActive',
];

function validateOffer(input, partial = false) {
  const body = {};
  const unknownFields = Object.keys(input).filter((field) => !allowedFields.includes(field));
  if (unknownFields.length) {return `Unknown offer field: ${unknownFields[0]}.`;}
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {body[field] = input[field];}
  }
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) {return 'name is required and must be 120 characters or fewer.';}
  }
  if (!partial || body.offerType !== undefined) {
    if (!['representative_apr', 'deferred_interest'].includes(body.offerType)) {return 'offerType must be representative_apr or deferred_interest.';}
  }
  for (const field of ['apr', 'standardApr']) {
    if (body[field] !== undefined && body[field] !== null && (!Number.isFinite(body[field]) || body[field] < 0 || body[field] > 100)) {
      return `${field} must be between 0 and 100.`;
    }
  }
  if (!partial || body.apr !== undefined) {
    if (!Number.isFinite(body.apr)) {return 'apr is required.';}
  }
  if (!partial || body.termMonths !== undefined) {
    if (!Number.isInteger(body.termMonths) || body.termMonths < 1 || body.termMonths > 360) {return 'termMonths must be between 1 and 360.';}
  }
  for (const field of ['minimumAmount', 'maximumAmount']) {
    if (body[field] !== undefined && body[field] !== null && (!Number.isFinite(body[field]) || body[field] < 0)) {
      return `${field} must be a non-negative amount.`;
    }
  }
  if (!partial || body.startsAt !== undefined || body.endsAt !== undefined) {
    const start = new Date(body.startsAt);
    const end = new Date(body.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return 'startsAt and endsAt must be valid dates, with endsAt after startsAt.';
    }
  }
  if (!partial || body.lenderDisclosure !== undefined) {
    if (typeof body.lenderDisclosure !== 'string' || !body.lenderDisclosure.trim() || body.lenderDisclosure.length > 5000) {
      return 'The verbatim lenderDisclosure is required and must be 5000 characters or fewer.';
    }
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {return 'isActive must be a boolean.';}
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const offers = await FinancingOffer.find().sort({ startsAt: -1 }).lean();
    res.json({ success: true, data: offers });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const validationError = validateOffer(req.body);
    if (validationError) {return next(createError(400, validationError));}
    const offer = await FinancingOffer.create(req.body);
    res.status(201).json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {return next(createError(400, 'Invalid financing offer ID.'));}
    const offer = await FinancingOffer.findById(req.params.id);
    if (!offer) {return next(createError(404, 'Financing offer not found.'));}
    const existingFields = Object.fromEntries(
      allowedFields.map((field) => [field, offer[field]])
    );
    const validationError = validateOffer({ ...existingFields, ...req.body });
    if (validationError) {return next(createError(400, validationError));}
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {offer[field] = req.body[field];}
    }
    await offer.save();
    res.json({ success: true, data: offer });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {return next(createError(400, 'Invalid financing offer ID.'));}
    const offer = await FinancingOffer.findByIdAndDelete(req.params.id);
    if (!offer) {return next(createError(404, 'Financing offer not found.'));}
    res.json({ success: true, message: 'Financing offer deleted.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
