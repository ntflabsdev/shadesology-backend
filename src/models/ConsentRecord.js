'use strict';

const mongoose = require('mongoose');

const consentRecordSchema = new mongoose.Schema({
  consentId: { type: String, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  necessary: { type: Boolean, required: true, default: true },
  analytics: { type: Boolean, required: true, default: false },
  marketing: { type: Boolean, required: true, default: false },
  policyVersion: { type: String, required: true },
  recordedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

consentRecordSchema.index({ user: 1, recordedAt: -1 });

module.exports = mongoose.model('ConsentRecord', consentRecordSchema);
