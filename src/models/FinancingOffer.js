'use strict';

const mongoose = require('mongoose');

const financingOfferSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  offerType: { type: String, enum: ['representative_apr', 'deferred_interest'], required: true },
  apr: { type: Number, required: true, min: 0, max: 100 },
  standardApr: { type: Number, default: null, min: 0, max: 100 },
  termMonths: { type: Number, required: true, min: 1, max: 360 },
  minimumAmount: { type: Number, default: 0, min: 0 },
  maximumAmount: { type: Number, default: null, min: 0 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  lenderDisclosure: { type: String, required: true, trim: true, maxlength: 5000 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, collection: 'financing_offers' });

financingOfferSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('FinancingOffer', financingOfferSchema);
