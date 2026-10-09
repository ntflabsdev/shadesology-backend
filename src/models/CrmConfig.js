'use strict';

const mongoose = require('mongoose');

const crmConfigSchema = new mongoose.Schema({
  singletonKey: { type: String, default: 'hubspot', unique: true },
  contactProperties: {
    type: Map,
    of: String,
    default: {
      email: 'email',
      firstName: 'firstname',
      lastName: 'lastname',
      phone: 'phone',
      company: 'company',
      leadSource: 'lead_source',
      enquiryType: 'enquiry_type',
      productInterest: 'product_interest',
      segment: 'segment',
      pricingTier: 'pricing_tier',
      leadStatus: 'lead_status',
      marketingConsent: 'shadesology_marketing_consent',
    },
  },
  dealProperties: {
    type: Map,
    of: String,
    default: {
      syncKey: 'shadesology_sync_key',
      dealType: 'shadesology_deal_type',
      quoteRef: 'shadesology_quote_ref',
      orderRef: 'shadesology_order_ref',
    },
  },
  quoteStageMap: { type: Map, of: String, default: {} },
  orderStageMap: { type: Map, of: String, default: {} },
  leadStatusMap: { type: Map, of: String, default: {} },
}, { timestamps: true });

module.exports = mongoose.models.CrmConfig || mongoose.model('CrmConfig', crmConfigSchema);
