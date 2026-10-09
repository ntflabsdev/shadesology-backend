'use strict';

const mongoose = require('mongoose');

const paymentWebhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  status: { type: String, enum: ['processing', 'processed'], default: 'processing' },
  processedAt: Date,
}, { timestamps: true, collection: 'payment_webhook_events' });

module.exports = mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
