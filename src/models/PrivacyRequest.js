'use strict';

const mongoose = require('mongoose');

const privacyRequestSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['access', 'deletion', 'do_not_sell'] },
  email: { type: String, lowercase: true, trim: true, default: null, select: false },
  emailHash: { type: String, required: true, index: true },
  status: {
    type: String,
    required: true,
    enum: ['verification_pending', 'queued', 'processing', 'completed', 'failed'],
    default: 'verification_pending',
  },
  verificationTokenHash: { type: String, default: null, select: false },
  verificationExpiresAt: { type: Date, default: null, select: false },
  verifiedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  failureCode: { type: String, default: '' },
}, { timestamps: true });

privacyRequestSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('PrivacyRequest', privacyRequestSchema);
