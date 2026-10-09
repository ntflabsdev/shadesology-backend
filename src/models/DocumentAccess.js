'use strict';

const mongoose = require('mongoose');

const documentAccessSchema = new mongoose.Schema({
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
  ip: { type: String, maxlength: 64, default: '' },
  userAgent: { type: String, maxlength: 500, default: '' },
}, { timestamps: true });

documentAccessSchema.index({ user: 1, createdAt: -1 });
documentAccessSchema.index({ company: 1, createdAt: -1 });

module.exports = mongoose.model('DocumentAccess', documentAccessSchema);
