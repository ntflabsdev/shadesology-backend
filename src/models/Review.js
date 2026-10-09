const mongoose = require('mongoose');

/**
 * Review — customer product review.
 *
 * Features:
 *  - Rating 1–5
 *  - Photo / video uploads
 *  - Verified purchase flag (set by order system)
 *  - Moderation queue (hold by default, auto-publish configurable per product type)
 *  - Review JSON-LD data surfaced via product API
 */
const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    // Reviewer — null for anonymous (guest) submissions
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Public display name (can differ from account name)
    displayName: { type: String, required: true, trim: true, maxlength: 80 },

    // Verified via order lookup at submission time
    isVerifiedPurchase: { type: Boolean, default: false },

    // Linked order (for verified purchase badge)
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },

    // ─── Content ───────────────────────────────────────────────────────────
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true, maxlength: 150, default: '' },
    body: { type: String, required: true, trim: true, maxlength: 5000 },

    // ─── Media ─────────────────────────────────────────────────────────────
    media: [
      {
        type: { type: String, enum: ['photo', 'video'], required: true },
        url: { type: String, required: true },
        thumbnailUrl: { type: String, default: '' },
        _id: false,
      },
    ],

    // ─── Moderation ────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'spam'],
      default: 'pending',
    },

    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    moderatedAt: { type: Date, default: null },
    moderationNote: { type: String, default: '' },

    // ─── Helpfulness ───────────────────────────────────────────────────────
    helpfulCount: { type: Number, default: 0 },
    notHelpfulCount: { type: Number, default: 0 },

    // ─── Source ────────────────────────────────────────────────────────────
    // For aggregated reviews imported from external platforms (Phase 2)
    source: {
      type: String,
      enum: ['shadesology', 'google', 'trustpilot', 'facebook', 'yelp'],
      default: 'shadesology',
    },
    externalId: { type: String, default: '' },  // external platform review ID

    // ─── Location ──────────────────────────────────────────────────────────
    // Optional — shown as "Verified buyer from [city, state]"
    location: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
reviewSchema.index({ product: 1, status: 1 });
reviewSchema.index({ user: 1 });
reviewSchema.index({ status: 1, createdAt: -1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ source: 1 });

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
