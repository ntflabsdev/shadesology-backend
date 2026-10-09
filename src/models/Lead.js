'use strict';

const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  enquiryType: {
    type: String,
    enum: ['contact', 'quote', 'service_request', 'dealer', 'installer', 'commercial_lease', 'commercial_project', 'chat', 'warranty_registration'],
    required: true,
    index: true,
  },
  leadQueue: {
    type: String,
    enum: ['consumer', 'commercial'],
    default: 'consumer',
    index: true,
  },
  commercialFlag: { type: Boolean, default: false, index: true },
  name: { type: String, required: true, trim: true, maxlength: 201 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, index: true },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  company: { type: String, trim: true, maxlength: 200, default: '' },
  subject: { type: String, trim: true, maxlength: 200, default: '' },
  issueType: { type: String, trim: true, maxlength: 100, default: '' },
  message: { type: String, required: true, trim: true, maxlength: 10000 },
  productType: { type: String, trim: true, maxlength: 100, default: '' },
  region: { type: String, trim: true, maxlength: 100, default: '' },
  orderNumber: { type: String, trim: true, maxlength: 100, default: '' },
  installDate: { type: Date, default: null },
  attachments: [{
    s3Key: { type: String, required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    _id: false,
  }],
  context: {
    pageUrl: { type: String, maxlength: 2048 },
    cartValue: { type: Number, min: 0 },
    cartItems: { type: Number, min: 0 },
  },
  applicationData: { type: mongoose.Schema.Types.Mixed, default: undefined },
  source: { type: String, trim: true, maxlength: 100, default: 'website' },
  status: { type: String, enum: ['new', 'assigned', 'contacted', 'closed'], default: 'new', index: true },
  crmSyncStatus: { type: String, enum: ['pending', 'synced', 'failed', 'skipped'], default: 'pending', index: true },
  hubspotContactId: { type: String, default: '' },
  hubspotDealId: { type: String, default: '' },
  crmLastSyncedAt: { type: Date, default: null },
  crmLastError: { type: String, default: '' },
  routedTo: { type: String, trim: true, maxlength: 254, default: '' },
  installerAssignment: {
    installer: { type: mongoose.Schema.Types.ObjectId, ref: 'Installer', default: null },
    status: { type: String, enum: ['offered', 'accepted', 'declined', 'completed'], default: undefined },
    assignedAt: Date,
    acceptedAt: Date,
  },
  ip: { type: String, maxlength: 64, default: '' },
}, { timestamps: true, collection: 'leads' });

leadSchema.index({ createdAt: -1 });
leadSchema.index({ enquiryType: 1, region: 1, productType: 1 });
leadSchema.index({ leadQueue: 1, createdAt: -1 });

leadSchema.pre('validate', function () {
  if (this.enquiryType === 'commercial_project') {
    this.leadQueue = 'commercial';
    this.commercialFlag = true;
  }
});

module.exports = mongoose.model('Lead', leadSchema);
