'use strict';

const mongoose = require('mongoose');

const leadRoutingConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  rules: [{
    enquiryType: { type: String, default: '' },
    productType: { type: String, default: '' },
    region: { type: String, default: '' },
    notifyEmail: { type: String, required: true, lowercase: true, trim: true },
  }],
}, { timestamps: true, collection: 'lead_routing_configs' });

module.exports = mongoose.model('LeadRoutingConfig', leadRoutingConfigSchema);
