'use strict';

const mongoose = require('mongoose');

const shippingRateRuleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  countries: [{ type: String, uppercase: true, trim: true }],
  states: [{ type: String, uppercase: true, trim: true }],
  restrictedStates: [{ type: String, uppercase: true, trim: true }],
  restrictedCountries: [{ type: String, uppercase: true, trim: true }],
  restrictedPostalPrefixes: [{ type: String, uppercase: true, trim: true }],
  freightClassMultipliers: { type: Map, of: Number, default: {} },
  baseRate: { type: Number, required: true, min: 0 },
  perPoundRate: { type: Number, default: 0, min: 0 },
  cratingCharge: { type: Number, default: 0, min: 0 },
  specialHandlingCharge: { type: Number, default: 0, min: 0 },
  transitDays: { type: Number, required: true, min: 1 },
  freeShippingThreshold: { type: Number, default: null, min: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, collection: 'shipping_rate_rules' });

shippingRateRuleSchema.index({ isActive: 1, countries: 1, states: 1 });

module.exports = mongoose.model('ShippingRateRule', shippingRateRuleSchema);
