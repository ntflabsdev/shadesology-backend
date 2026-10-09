'use strict';

const mongoose = require('mongoose');

/**
 * Cart — persisted cart for both guest and registered users.
 *
 * Guest carts are keyed by a UUID stored in a cookie.
 * Registered carts are linked to a user._id.
 * When a guest logs in, their guest cart is merged into their user cart.
 *
 * Each line item holds the FULL option set so production receives an
 * unambiguous order and the cart can re-configure correctly.
 *
 * Prices are NOT stored in the cart — they are resolved fresh from
 * packages/pricing on every cart view and at checkout validation
 * to catch price changes between add-to-cart and checkout.
 */

const lineItemSchema = new mongoose.Schema(
  {
    product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variant:  { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    /** selectedOptions: { optionGroupSlug: { value, name, surchargeType, surchargeAmount } } */
    selectedOptions: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    /** Snapshot of price at time of add-to-cart — used to detect price changes at checkout */
    snapshotPrice: { type: Number, default: null },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    // One of these will be set (not both)
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    guestId: { type: String, default: null, index: true }, // UUID from cookie

    items: [lineItemSchema],

    /** Used for abandoned-cart recovery — set at checkout entry */
    contactEmail: { type: String, lowercase: true, trim: true, default: null },
    contactName:  { type: String, default: null },

    /** Track CRM sync status for abandoned-cart recovery */
    crmSyncStatus: {
      type: String,
      enum: ['pending', 'synced', 'failed', 'skipped'],
      default: 'skipped',
    },
    hubspotContactId: { type: String, default: '' },
    crmLastSyncedAt: { type: Date, default: null },
    crmLastError: { type: String, default: '' },

    /** Coupon/promo codes applied */
    couponCodes: [{ type: String, uppercase: true, trim: true }],

    /** Timestamp when user entered checkout — used for abandonment detection */
    checkoutStartedAt: { type: Date, default: null },

    /** Cart expires 90 days after last activity */
    expiresAt: { type: Date, default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);

// Keep expiresAt rolling on every save
cartSchema.pre('save', function () {
  this.expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
});

// TTL index — MongoDB auto-deletes expired carts
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Cart', cartSchema);
