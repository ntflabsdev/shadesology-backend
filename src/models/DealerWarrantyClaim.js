'use strict';

const mongoose = require('mongoose');

const dealerWarrantyClaimSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  model: { type: String, required: true, trim: true, maxlength: 200 },
  serialNumber: { type: String, trim: true, maxlength: 120, default: '' },
  issue: { type: String, required: true, trim: true, maxlength: 5000 },
  photos: [{
    key: { type: String, required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    _id: false,
  }],
  status: {
    type: String,
    enum: ['submitted', 'in_review', 'approved', 'declined', 'resolved'],
    default: 'submitted',
    index: true,
  },
  resolution: { type: String, trim: true, maxlength: 2000, default: '' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

dealerWarrantyClaimSchema.index({ company: 1, createdAt: -1 });

module.exports = mongoose.model('DealerWarrantyClaim', dealerWarrantyClaimSchema);
