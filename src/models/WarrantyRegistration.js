'use strict';

const mongoose = require('mongoose');

const warrantyRegistrationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 201 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  productType: { type: String, required: true, trim: true, maxlength: 100 },
  model: { type: String, required: true, trim: true, maxlength: 200 },
  serialNumber: { type: String, trim: true, maxlength: 100, default: '' },
  orderNumber: { type: String, trim: true, maxlength: 100, default: '' },
  installDate: { type: Date, required: true },
  status: { type: String, enum: ['received', 'reviewed'], default: 'received' },
}, { timestamps: true, collection: 'warranty_registrations' });

warrantyRegistrationSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('WarrantyRegistration', warrantyRegistrationSchema);
