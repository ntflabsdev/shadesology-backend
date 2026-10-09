const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * ProductType — one of the 9 core shade product types.
 * e.g. Retractable Awning, Fabric Pergola, Louvered Roof, Shade Sail,
 *      Retractable Screen, Horizontal Blind, Umbrella, Pool Cover, Tensile Structure
 *
 * Drives which configurator, which content modules, and which attributes show
 * on a product detail page.
 */
const productTypeSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: translatableField(),

    // Internal code used by the configurator engine and content-module rules
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      // e.g. RETRACTABLE_AWNING, FABRIC_PERGOLA, LOUVERED_ROOF …
    },

    // Which content modules are visible on the PDP for this product type
    // Values map to module keys checked in the product detail page
    activeModules: {
      type: [String],
      enum: [
        'specifications',
        'operation_motorization',
        'frame_features',
        'fabric_valance_thread',
        'heat_sealing',
        'accessories',
        'installation_types',
        'manuals',
        'faq',
        'warranty',
        'financing',
        'comparison',
      ],
      default: ['specifications', 'accessories', 'manuals', 'faq', 'warranty'],
    },

    // Whether this product type uses the configurator
    hasConfigurator: { type: Boolean, default: false },

    // Configurator key — links to the configurator engine ruleset
    configuratorKey: { type: String, default: null },

    icon: { type: String, default: '' },

    image: {
      url: { type: String, default: '' },
      alt: translatableField(),
    },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    // SEO
    metaTitle: translatableField(),
    metaDescription: translatableField(),
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
productTypeSchema.index({ isActive: 1, sortOrder: 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
productTypeSchema.pre('save', function () {
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(this.name.en);
  }
});

const ProductType = mongoose.model('ProductType', productTypeSchema);

module.exports = ProductType;
