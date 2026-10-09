const mongoose = require('mongoose');

/**
 * Redirect — manages 301/302 URL redirects.
 *
 * Used by:
 *  - The redirect manager (Phase 2) for old-site URL migration
 *  - Staff creating manual redirects via /admin
 *
 * The redirect middleware in apps/web checks this collection on every 404.
 */
const redirectSchema = new mongoose.Schema(
  {
    // Source path (without domain) e.g. "/old-awnings-page"
    from: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    // Destination path or full URL
    to: {
      type: String,
      required: true,
      trim: true,
    },

    // HTTP status code
    statusCode: {
      type: Number,
      enum: [301, 302],
      default: 301,
    },

    // Why this redirect exists (internal note)
    reason: { type: String, default: '' },

    // Track hits for the post-launch crawl-check report
    hitCount: { type: Number, default: 0 },
    lastHitAt: { type: Date, default: null },

    // Source of the redirect (manual or bulk import)
    source: {
      type: String,
      enum: ['manual', 'import', 'auto'],
      default: 'manual',
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
redirectSchema.index({ isActive: 1 });

const Redirect = mongoose.model('Redirect', redirectSchema);

module.exports = Redirect;
