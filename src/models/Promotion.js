'use strict';

const mongoose = require('mongoose');

/**
 * Promotion — discount rules applied at cart / order level.
 *
 * Types:
 *   percentage   — % off order subtotal
 *   fixed        — flat $ off order subtotal
 *   product_scoped — % off line items for specific product(s)
 *
 * A Promotion is either:
 *   - auto-applied (code is null, applies to all orders where conditions pass)
 *   - coupon-code  (code is set, customer must enter it)
 */
const promotionSchema = new mongoose.Schema(
  {
    name:  { type: String, required: true, trim: true },
    code:  { type: String, uppercase: true, trim: true, default: null, sparse: true }, // null = auto-apply

    type: {
      type: String,
      enum: ['percentage', 'fixed', 'product_scoped'],
      required: true,
    },
    value: { type: Number, required: true, min: 0 }, // % or $ depending on type

    // product_scoped only
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    active: { type: Boolean, default: true },

    startDate: { type: Date, default: null },
    endDate:   { type: Date, default: null },

    maxUses:   { type: Number, default: null }, // null = unlimited
    usedCount: { type: Number, default: 0 },

    // min order subtotal to be eligible (optional)
    minimumOrderAmount: { type: Number, default: 0 },

    description: { type: String, default: '' },
  },
  { timestamps: true }
);

promotionSchema.index({ active: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('Promotion', promotionSchema);
