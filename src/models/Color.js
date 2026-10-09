const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * Color — frame / powder-coat colors available for products.
 * Linked to Variants and OptionGroups via reference.
 * Supports RAL, standard, and custom color systems.
 */
const colorSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Color system
    system: {
      type: String,
      enum: ['ral', 'standard', 'exclusive', 'custom'],
      default: 'standard',
    },

    // RAL number or internal code
    code: { type: String, trim: true, default: '' },

    // Hex value for UI swatch rendering
    hexValue: {
      type: String,
      trim: true,
      default: '',
      match: [/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$|^$/, 'Invalid hex color'],
    },

    // Swatch image (takes priority over hexValue if present)
    swatchImage: {
      url: { type: String, default: '' },
      alt: translatableField(),
    },

    // Texture / finish
    finish: {
      type: String,
      enum: ['matte', 'gloss', 'satin', 'metallic', 'textured', ''],
      default: '',
    },

    // Price surcharge for this color (used when color is a selectable option)
    // Stored here as a reference; actual surcharge is on the OptionGroup/Option
    hasSurcharge: { type: Boolean, default: false },

    // Availability — some colors are discontinued or coming soon
    availabilityStatus: {
      type: String,
      enum: ['available', 'discontinued', 'coming_soon'],
      default: 'available',
    },
    availableFrom: { type: Date, default: null },

    // Which product types this color applies to (empty = all)
    compatibleProductTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
colorSchema.index({ code: 1 });
colorSchema.index({ system: 1 });
colorSchema.index({ isActive: 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
colorSchema.pre('save', function () {
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(this.code ? `${this.code}-${this.name.en}` : this.name.en);
  }
});

const Color = mongoose.model('Color', colorSchema);

module.exports = Color;
