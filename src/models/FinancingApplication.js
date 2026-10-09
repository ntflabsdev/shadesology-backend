'use strict';

const mongoose = require('mongoose');

const financingApplicationSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  applicationType: { type: String, enum: ['consumer', 'commercial_lease'], required: true },
  status: {
    type: String,
    enum: ['started', 'prequalified', 'approved', 'declined', 'abandoned', 'handoff_unavailable'],
    default: 'started',
    index: true,
  },
  firstName: { type: String, required: true, trim: true, maxlength: 100 },
  lastName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  company: { type: String, trim: true, maxlength: 200 },
  requestedAmount: { type: Number, required: true, min: 0.01 },
  approvedAmount: { type: Number, min: 0 },
  provider: { type: String, required: true },
  providerReference: { type: String, trim: true, maxlength: 200 },
  consentAt: { type: Date, required: true },
  statusHistory: [{
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    providerReference: String,
  }],
}, { timestamps: true, collection: 'financing_applications' });

financingApplicationSchema.index({ email: 1, createdAt: -1 });
financingApplicationSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('FinancingApplication', financingApplicationSchema);
