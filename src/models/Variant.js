const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * Variant (Model) — a specific orderable configuration of a Product.
 * e.g. "Weinor Cassita II 3m × 2.5m Manual" is a Variant of the Cassita II product.
 *
 * Each Variant has its own:
 *  - Base price (retail + dealer tiers)
 *  - Lead time and availability
 *  - Freight class and shipping dimensions
 *  - Allowed option groups (which options can be selected for this model)
 */
const variantSchema = new mongoose.Schema(
  {
    // Parent product
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    name: translatableField({ required: true }),

    // Internal SKU
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    // ─── Pricing ───────────────────────────────────────────────────────────
    // Base retail price (USD, before surcharges)
    basePrice: { type: Number, required: true, min: 0 },

    // Wholesale / dealer price tiers
    // Array allows arbitrary number of tiers (dealer1, dealer2, wholesale, etc.)
    priceTiers: [
      {
        tierKey: { type: String, required: true }, // e.g. "dealer", "wholesale", "trade"
        price: { type: Number, required: true, min: 0 },
        _id: false,
      },
    ],

    // ─── Dimensions ────────────────────────────────────────────────────────
    // Stored in imperial (inches); metric calculated on read
    widthMin: { type: Number, default: null },   // inches
    widthMax: { type: Number, default: null },
    projectionMin: { type: Number, default: null },
    projectionMax: { type: Number, default: null },
    heightMin: { type: Number, default: null },
    heightMax: { type: Number, default: null },

    // ─── Shipping ──────────────────────────────────────────────────────────
    // LTL freight class (50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500)
    freightClass: { type: Number, default: null },

    // Packed/crated dimensions for shipping
    shippingLengthIn: { type: Number, default: null },
    shippingWidthIn: { type: Number, default: null },
    shippingHeightIn: { type: Number, default: null },
    shippingWeightLbs: { type: Number, default: null },

    requiresCrating: { type: Boolean, default: false },
    specialHandlingCharges: [{
      label: { type: String, required: true },
      amount: { type: Number, required: true, min: 0 },
      _id: false,
    }],

    // ─── Lead time ─────────────────────────────────────────────────────────
    // Production lead time in business days
    leadTimeDays: { type: Number, default: 14 },
    leadTimeNote: translatableField(),

    // ─── Availability ──────────────────────────────────────────────────────
    availability: {
      type: String,
      enum: ['in_stock', 'made_to_order', 'discontinued', 'coming_soon'],
      default: 'made_to_order',
    },

    // ─── Allowed options ───────────────────────────────────────────────────
    // Which option groups are available for this specific variant
    allowedOptionGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'OptionGroup' }],

    // ─── Media ─────────────────────────────────────────────────────────────
    images: [
      {
        url: { type: String, required: true },
        alt: translatableField(),
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    // ─── Flags ─────────────────────────────────────────────────────────────
    isDefault: { type: Boolean, default: false }, // default selected variant on PDP
    isActive: { type: Boolean, default: true },

    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 });
variantSchema.index({ availability: 1 });
variantSchema.index({ isActive: 1 });

const Variant = mongoose.model('Variant', variantSchema);

module.exports = Variant;
