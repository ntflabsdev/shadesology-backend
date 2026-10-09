'use strict';

const mongoose = require('mongoose');

const dealerTrainingProgressSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

dealerTrainingProgressSchema.index({ user: 1, document: 1 }, { unique: true });
dealerTrainingProgressSchema.index({ company: 1, user: 1 });

module.exports = mongoose.model('DealerTrainingProgress', dealerTrainingProgressSchema);
