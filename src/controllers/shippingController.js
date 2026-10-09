'use strict';

const mongoose = require('mongoose');
const Variant = require('../models/Variant');
const ShippingRateRule = require('../models/ShippingRateRule');
const { createError } = require('../middlewares/errorHandler');
const { getDeliveryEstimate } = require('../services/shipping');

const deliveryEstimate = async (req, res, next) => {
  try {
    const variantIds = String(req.query.variantIds || '').split(',').filter(Boolean);
    const address = {
      zip: String(req.query.zip || '').trim(),
      state: String(req.query.state || '').trim().toUpperCase(),
      country: String(req.query.country || 'US').trim().toUpperCase(),
    };
    if (!address.zip || variantIds.length === 0 || variantIds.length > 20) {
      return next(createError(400, 'zip and 1–20 variantIds are required.'));
    }
    if (variantIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      return next(createError(400, 'One or more variantIds are invalid.'));
    }
    const variants = await Variant.find({ _id: { $in: variantIds }, isActive: true })
      .select('leadTimeDays')
      .lean();
    if (variants.length !== variantIds.length) return next(createError(404, 'One or more active products were not found.'));
    const estimate = await getDeliveryEstimate({ address, items: variants.map((variant) => ({ variant })) });
    res.json({ success: true, data: estimate });
  } catch (err) {
    next(err);
  }
};

const adminListShippingRates = async (req, res, next) => {
  try {
    const data = await ShippingRateRule.find().sort({ createdAt: 1 }).lean();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const adminCreateShippingRate = async (req, res, next) => {
  try {
    const rule = await ShippingRateRule.create(req.body);
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
};

const adminUpdateShippingRate = async (req, res, next) => {
  try {
    const rule = await ShippingRateRule.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!rule) return next(createError(404, 'Shipping rate rule not found.'));
    res.json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
};

const adminDeleteShippingRate = async (req, res, next) => {
  try {
    const rule = await ShippingRateRule.findByIdAndDelete(req.params.id);
    if (!rule) return next(createError(404, 'Shipping rate rule not found.'));
    res.json({ success: true, message: 'Shipping rate rule deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  deliveryEstimate,
  adminListShippingRates,
  adminCreateShippingRate,
  adminUpdateShippingRate,
  adminDeleteShippingRate,
};
