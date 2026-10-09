'use strict';

const mongoose = require('mongoose');

const companyInvitationSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['dealer', 'specifier'], required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acceptedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

companyInvitationSchema.index({ company: 1, email: 1, acceptedAt: 1 });
companyInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CompanyInvitation', companyInvitationSchema);
