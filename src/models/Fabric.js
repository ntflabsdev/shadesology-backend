const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * Fabric — a specific fabric product used in awnings, pergolas, shade sails etc.
 * Linked to products via the Product model's fabrics array.
 * ~500 fabrics expected; imported via catalog import tool.
 */
const fabricSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // SKU / part number from manufacturer
    sku: { type: String, trim: true, default: '' },

    brand: { type: String, trim: true, default: '' },

    // Sub-range within a brand e.g. "Dickson Orchestra", "Serge Ferrari Précontraint"
    subRange: { type: String, trim: true, default: '' },

    description: translatableField(),

    // Physical properties
    composition: { type: String, trim: true, default: '' },     // e.g. "100% Acrylic"
    opennessFactor: { type: Number, min: 0, max: 100, default: null }, // % openness
    weightGsm: { type: Number, default: null },                 // g/m²
    widthCm: { type: Number, default: null },                   // roll width in cm

    // Solar / UV data
    solarReflectance: { type: Number, default: null },
    solarAbsorption: { type: Number, default: null },
    solarTransmittance: { type: Number, default: null },
    uvBlock: { type: Number, default: null },                   // % UV blocked

    // Warranty
    warrantyYears: { type: Number, default: null },
    warrantyNotes: translatableField(),

    // Visual
    color: { type: String, trim: true, default: '' },
    pattern: {
      type: String,
      enum: ['solid', 'stripe', 'tweed', 'weave', 'custom', ''],
      default: '',
    },
    opacity: {
      type: String,
      enum: ['sheer', 'semi_sheer', 'semi_opaque', 'opaque', ''],
      default: '',
    },

    images: [
      {
        url: { type: String, required: true },
        alt: translatableField(),
        isSwatch: { type: Boolean, default: false },
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    // Which product types this fabric can be used with
    compatibleProductTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],

    // Availability — can be restricted to certain models
    isAvailable: { type: Boolean, default: true },

    // Allow sample requests
    sampleAvailable: { type: Boolean, default: true },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
fabricSchema.index({ brand: 1 });
fabricSchema.index({ isActive: 1 });
fabricSchema.index({ compatibleProductTypes: 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
fabricSchema.pre('save', function () {
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(`${this.brand}-${this.name.en}`);
  }
});

const Fabric = mongoose.model('Fabric', fabricSchema);

module.exports = Fabric;
