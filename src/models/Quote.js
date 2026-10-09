'use strict';

const mongoose = require('mongoose');

function getQuoteExpiryDate() {
  const configuredDays = Number(process.env.QUOTE_EXPIRY_DAYS);
  const expiryDays = Number.isFinite(configuredDays) && configuredDays > 0
    ? configuredDays
    : 30;
  return new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
}

/**
 * Quote — a customer quote request.
 *
 * Lifecycle: draft → submitted → in_review → quoted → accepted → ordered | expired | declined
 *
 * Quotes are stored in DB FIRST before any outbound call (email / CRM).
 * All file attachments go to the private S3 bucket (signed URLs only).
 * Price is locked when a quote converts to an order.
 */

// ── Line item ─────────────────────────────────────────────────────────────────
const quoteLineSchema = new mongoose.Schema(
  {
    product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variant:     { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' },
    productName: String,
    variantName: String,
    sku:         String,
    quantity:    { type: Number, default: 1, min: 1 },
    /** Selected options: { optionGroupSlug: optionValue, ... } */
    selectedOptions: { type: Map, of: String, default: {} },
    unitPrice:    { type: Number, default: null },   // null until staff quotes
    totalPrice:   { type: Number, default: null },
    notes:        String,
  },
  { _id: true }
);

// ── Attachment ────────────────────────────────────────────────────────────────
const attachmentSchema = new mongoose.Schema(
  {
    /** S3 object key in private bucket */
    s3Key:       { type: String, required: true },
    filename:    { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes:   { type: Number, required: true, min: 1 },
    uploadedAt:  { type: Date, default: Date.now },
  },
  { _id: true }
);

// ── Main schema ───────────────────────────────────────────────────────────────
const quoteSchema = new mongoose.Schema(
  {
    // Reference number e.g. QT-2026-0001
    referenceNumber: {
      type: String,
      unique: true,
    },

    // ─── Customer ─────────────────────────────────────────────────────────────
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /** Guest contact (used when user is null) */
    guestContact: {
      firstName: String,
      lastName:  String,
      email:     { type: String, lowercase: true, trim: true },
      phone:     String,
      company:   String,
    },

    // ─── Items ────────────────────────────────────────────────────────────────
    items: [quoteLineSchema],

    // ─── Project details ──────────────────────────────────────────────────────
    projectDescription: String,
    installationAddress: {
      line1:   String,
      city:    String,
      state:   String,
      zip:     String,
      country: { type: String, default: 'US' },
    },
    buildingType: {
      type: String,
      enum: ['residential', 'commercial', 'industrial', 'government', 'other'],
      default: 'residential',
    },
    /** Which segment this quote came from (for routing) */
    segment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Segment',
      default: null,
    },

    // ─── Files ────────────────────────────────────────────────────────────────
    attachments: [attachmentSchema],

    // ─── Pricing (populated by staff) ─────────────────────────────────────────
    subtotal:      { type: Number, default: null },
    tax:           { type: Number, default: null },
    total:         { type: Number, default: null },
    currency:      { type: String, default: 'USD' },
    /** Lock price when quote is accepted — prevents drift after materials change */
    priceLocked:   { type: Boolean, default: false },
    pricedAt:      Date,

    // ─── PDF ──────────────────────────────────────────────────────────────────
    /** S3 key of the generated quote PDF in private bucket */
    pdfS3Key: String,

    // ─── Routing / queue ──────────────────────────────────────────────────────
    enquiryQueue: {
      type: String,
      enum: ['consumer', 'commercial'],
      default: 'consumer',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ─── Status ───────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['draft', 'submitted', 'in_review', 'quoted', 'accepted', 'ordered', 'expired', 'declined'],
      default: 'submitted',
      index: true,
    },
    statusHistory: [
      {
        status:    String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note:      String,
        at:        { type: Date, default: Date.now },
      },
    ],

    // ─── Expiry ───────────────────────────────────────────────────────────────
    expiresAt: {
      type: Date,
      default: getQuoteExpiryDate,
    },
    followUpSentAt: Date,

    // ─── Converted order ──────────────────────────────────────────────────────
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },

    // ─── Guest status tracking ────────────────────────────────────────────────
    /**
     * One-time token included in the autoresponder email so a guest can view
     * their quote status at /quote/status/:referenceNumber?token=xxx without
     * creating an account. Stored hashed. Expires with the quote.
     */
    guestToken:     { type: String, default: null, select: false },
    guestTokenHash: { type: String, default: null, select: false, index: true },
    guestTokenHashes: { type: [String], default: [], select: false },

    // ─── CRM sync ─────────────────────────────────────────────────────────────
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
    emailSentAt: Date,
  },
  {
    timestamps: true,
    collection: 'quotes',
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
quoteSchema.index({ 'guestContact.email': 1 });
quoteSchema.index({ status: 1, createdAt: -1 });
quoteSchema.index({ user: 1, createdAt: -1 });
quoteSchema.index({ enquiryQueue: 1, status: 1 });
quoteSchema.index({ expiresAt: 1, status: 1 });

// ── Auto-generate reference number + guest token ─────────────────────────────
quoteSchema.pre('save', async function () {
  if (this.isNew && !this.referenceNumber) {
    const year  = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      referenceNumber: { $regex: `^QT-${year}-` },
    });
    this.referenceNumber = `QT-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // Generate a guest access token for un-authenticated quote owners
  if (this.isNew && !this.user && !this.guestTokenHash) {
    const { randomBytes, createHash } = require('node:crypto');
    const raw = randomBytes(32).toString('hex');
    this.guestToken     = raw; // returned in the API response once, then cleared
    this.guestTokenHash = createHash('sha256').update(raw).digest('hex');
  }
});

module.exports = mongoose.model('Quote', quoteSchema);
