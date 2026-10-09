'use strict';

const mongoose = require('mongoose');

const checkoutQuoteSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  cartId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cart', required: true },
  fingerprint: { type: String, required: true },
  shippingAddress: { type: mongoose.Schema.Types.Mixed, required: true },
  selectedShipping: {
    rateRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShippingRateRule', default: null },
    carrierRateId: { type: String, default: null },
    carrierName: { type: String, required: true },
    label: { type: String, required: true },
    cost: { type: Number, required: true, min: 0 },
    charges: [{ label: String, amount: Number }],
    productionDays: Number,
    transitDays: Number,
    estimatedDeliveryDate: Date,
  },
  subtotal: { type: Number, required: true, min: 0 },
  discountAmount: { type: Number, required: true, min: 0 },
  tax: { type: Number, required: true, min: 0 },
  taxRate: Number,
  total: { type: Number, required: true, min: 0 },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'checkout_quotes' });

checkoutQuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
checkoutQuoteSchema.index({ cartId: 1, createdAt: -1 });

module.exports = mongoose.model('CheckoutQuote', checkoutQuoteSchema);
