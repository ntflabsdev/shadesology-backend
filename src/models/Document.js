const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * Document — versioned file asset (manual, spec sheet, price list, BIM, CAD,
 * certificate, warranty, engineering report, brochure, color chart).
 *
 * Features:
 *  - Version history (new upload = new version, old kept)
 *  - Effective date + expiry date (expired docs auto-withdrawn from listings)
 *  - Gating flag: open (no auth) | email_required | logged_in | role_required
 *  - Download tracking (count stored here; detail in a separate event log)
 */
const documentVersionSchema = new mongoose.Schema(
  {
    version: { type: String, required: true },          // e.g. "2.1"
    fileUrl: { type: String, required: true },
    fileSizeBytes: { type: Number, default: 0 },
    mimeType: { type: String, default: 'application/pdf' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
    _id: false,
  }
);

const documentSchema = new mongoose.Schema(
  {
    title: translatableField({ required: true }),

    // Document category
    type: {
      type: String,
      required: true,
      enum: [
        'manual',
        'spec_sheet',
        'price_list',
        'order_form',
        'bim',
        'cad',
        'certificate',
        'warranty',
        'engineering_report',
        'brochure',
        'color_chart',
        'other',
      ],
    },

    description: translatableField(),

    // ─── Versioning ────────────────────────────────────────────────────────
    currentVersion: { type: String, required: true, default: '1.0' },
    versions: [documentVersionSchema],                  // full version history

    // Active file (mirrors latest version for quick access)
    fileUrl: { type: String, required: true },
    fileSizeBytes: { type: Number, default: 0 },
    mimeType: { type: String, default: 'application/pdf' },

    // ─── Effective / expiry dates ──────────────────────────────────────────
    effectiveDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },          // null = never expires

    // ─── Access gating ─────────────────────────────────────────────────────
    gating: {
      type: String,
      enum: ['open', 'email_required', 'logged_in', 'role_required'],
      default: 'open',
    },
    // Required role when gating = role_required
    requiredRole: {
      type: String,
      enum: ['customer', 'installer', 'specifier', 'dealer', 'staff', ''],
      default: '',
    },

    // ─── Associations ──────────────────────────────────────────────────────
    // Attach to specific products, product types, or manufacturers
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    productTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],
    manufacturers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Manufacturer' }],

    // Target audience tags for the resource library filter
    audienceTags: {
      type: [String],
      enum: ['consumer', 'installer', 'specifier', 'dealer', 'architect', 'engineer'],
      default: [],
    },

    // ─── Tracking ──────────────────────────────────────────────────────────
    downloadCount: { type: Number, default: 0 },

    // ─── Flags ─────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    showInResourceLibrary: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
documentSchema.index({ type: 1 });
documentSchema.index({ products: 1 });
documentSchema.index({ productTypes: 1 });
documentSchema.index({ expiryDate: 1 });
documentSchema.index({ isActive: 1 });

// ─── Virtual: isExpired ───────────────────────────────────────────────────────
documentSchema.virtual('isExpired').get(function () {
  if (!this.expiryDate) {
    return false;
  }
  return new Date() > this.expiryDate;
});

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;
