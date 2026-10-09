'use strict';

const mongoose = require('mongoose');

const hubSpotWebhookEventSchema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  eventId: { type: String, default: '' },
  objectType: { type: String, required: true },
  objectId: { type: String, required: true },
  propertyName: { type: String, default: '' },
  propertyValue: { type: String, default: '' },
  status: { type: String, enum: ['processing', 'processed'], default: 'processing' },
  processedAt: { type: Date, default: null },
}, { timestamps: true, collection: 'hubspot_webhook_events' });

module.exports = mongoose.models.HubSpotWebhookEvent ||
  mongoose.model('HubSpotWebhookEvent', hubSpotWebhookEventSchema);
