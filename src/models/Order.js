'use strict';

const mongoose = require('mongoose');

/**
 * Order — a placed order after successful payment or deposit.
 *
 * Order status lifecycle:
 *   pending → payment_processing → confirmed → in_production →
 *   ready_to_ship → shipped → delivered → cancelled | refunded
 *
 * Prices are LOCKED at order creation — they never change after that.
 */

const orderLineSchema = new mongoose.Schema(
  {
    product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variant:     { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' },
    productName: String,
    variantName: String,
    sku:         String,
    quantity:    { type: Number, required: true, min: 1 },
    availability: { type: String, enum: ['in_stock', 'made_to_order', 'discontinued', 'coming_soon'], default: 'made_to_order' },
    selectedOptions: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

    // Locked pricing breakdown (from @shadesology/pricing)
    unitPrice:       Number,
    surcharges:      [{
      label:  { type: String },
      kind:   { type: String },   // 'fixed' | 'percent' | 'per_unit'  (renamed from 'type' — Mongoose reserved word)
      amount: { type: Number },
    }],
    totalSurcharge:  Number,
    lineTotal:       Number,
    priceType:       String,
  },
  { _id: true }
);

const addressSchema = new mongoose.Schema({
  firstName: String,
  lastName:  String,
  company:   String,
  line1:     String,
  line2:     String,
  city:      String,
  state:     String,
  zip:       String,
  country:   { type: String, default: 'US' },
  phone:     String,
}, { _id: false });

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true },

    // ─── Customer ───────────────────────────────────────────────────────────
    user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    company:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
    purchaseOrderNumber: { type: String, trim: true, maxlength: 100, default: '' },
    guestEmail:   { type: String, lowercase: true, trim: true, default: null },
    guestName:    String,
    isGuest:      { type: Boolean, default: false },

    // ─── Items ───────────────────────────────────────────────────────────────
    items: [orderLineSchema],

    // ─── Addresses ──────────────────────────────────────────────────────────
    shippingAddress: addressSchema,
    billingAddress:  addressSchema,
    sameAsBilling:   { type: Boolean, default: true },

    // ─── Pricing (locked at creation) ────────────────────────────────────────
    subtotal:        Number,
    shippingCost:    Number,
    shippingLabel:   String,
    shippingCharges: [{ label: String, amount: Number }],
    shippingRateRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShippingRateRule', default: null },
    carrierRateId: String,
    discountAmount:  { type: Number, default: 0 },
    couponCodes:     [String],
    tax:             { type: Number, default: 0 },
    taxRate:         Number,
    total:           Number,
    currency:        { type: String, default: 'USD' },

    // ─── Payment ─────────────────────────────────────────────────────────────
    paymentMethod:   String,
    /** Stripe Payment Intent ID or offline ref */
    paymentIntentId: String,
    stripeCheckoutSessionId: String,
    paymentCheckoutUrl: String,
    checkoutKey: { type: String, unique: true, sparse: true },
    /** deposit only: amount collected upfront */
    depositAmount:   Number,
    /** balance due before dispatch */
    balanceDue:      Number,
    paymentStatus: {
      type: String,
      enum: ['pending', 'deposit_paid', 'paid', 'partially_refunded', 'fully_refunded', 'failed'],
      default: 'pending',
    },
    paymentTransactions: [{
      paymentIntentId: String,
      amount: { type: Number, required: true, min: 0 },
      refundedAmount: { type: Number, default: 0, min: 0 },
      createdAt: { type: Date, default: Date.now },
    }],
    balancePaid: { type: Number, default: 0, min: 0 },

    // ─── Shipping / tracking ─────────────────────────────────────────────────
    trackingNumber:  String,
    trackingUrl:     String,
    carrierName:     String,
    estimatedDeliveryDate: Date,

    // ─── Source ──────────────────────────────────────────────────────────────
    /** 'cart' | 'quote_conversion' */
    source:    { type: String, enum: ['cart', 'quote_conversion'], default: 'cart' },
    quoteId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Quote', default: null },

    // ─── Status ──────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'payment_processing', 'confirmed', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },
    statusHistory: [
      {
        status:    String,
        note:      String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at:        { type: Date, default: Date.now },
      },
    ],
    customerRequests: [{
      type: { type: String, enum: ['cancellation', 'return'], required: true },
      reason: { type: String, required: true, trim: true, maxlength: 1000 },
      itemAvailability: [{ type: String, enum: ['in_stock', 'made_to_order'] }],
      status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
      resolutionNote: { type: String, trim: true, maxlength: 1000 },
      createdAt: { type: Date, default: Date.now },
      reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    }],

    // ─── Communications ─────────────────────────────────────────────────────
    confirmationEmailSentAt: Date,
    emailSentAt: Date,

    // ─── CRM sync ────────────────────────────────────────────────────────────
    crmSyncStatus: {
      type: String,
      enum: ['pending', 'synced', 'failed', 'skipped'],
      default: 'pending',
    },
    crmDealId: String,
    hubspotContactId: { type: String, default: '' },
    hubspotDealId: { type: String, default: '' },
    crmLastSyncedAt: { type: Date, default: null },
    crmLastError: { type: String, default: '' },

    // ─── Cancellation / refund ──────────────────────────────────────────────
    cancellationReason: String,
    refundAmount: Number,
    refundedAt: Date,
    refunds: [{
      amount: { type: Number, required: true, min: 1 },
      providerRefundId: String,
      requestKey: String,
      reason: String,
      createdAt: { type: Date, default: Date.now },
    }],

    // ─── Production export ───────────────────────────────────────────────────
    productionExportedAt: Date,
    productionExportS3Key: String,
  },
  {
    timestamps: true,
    collection: 'orders',
  }
);

orderSchema.index({ 'user': 1, createdAt: -1 });
orderSchema.index({ 'guestEmail': 1 });
orderSchema.index({ paymentIntentId: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index(
  { quoteId: 1 },
  { unique: true, partialFilterExpression: { source: 'quote_conversion' } }
);

// Auto-generate order number
orderSchema.pre('save', async function () {
  if (this.isNew && !this.orderNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      orderNumber: { $regex: `^SH-${year}-` },
    });
    this.orderNumber = `SH-${year}-${String(count + 1).padStart(5, '0')}`;
  }
});

module.exports = mongoose.model('Order', orderSchema);
