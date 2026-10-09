const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * Accessory — a standalone add-on / linked product.
 * e.g. wind sensor, sun sensor, remote control, mounting bracket, LED lighting kit.
 *
 * Accessories are cross-sold on product pages and can also be standalone products.
 * They use the same pricing engine as products (base price + surcharges).
 */
const accessorySchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    sku: { type: String, trim: true, uppercase: true, default: '' },

    description: translatableField(),
    shortDescription: translatableField(),

    // ─── Classification ────────────────────────────────────────────────────
    // Which product types this accessory is compatible with
    compatibleProductTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],

    // Which specific products/variants it's compatible with (optional override)
    compatibleProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // ─── Pricing ───────────────────────────────────────────────────────────
    basePrice: { type: Number, required: true, min: 0 },
    priceTiers: [
      {
        tierKey: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
        _id: false,
      },
    ],

    // ─── Media ─────────────────────────────────────────────────────────────
    images: [
      {
        url: { type: String, required: true },
        alt: translatableField(),
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    // ─── Availability ──────────────────────────────────────────────────────
    availability: {
      type: String,
      enum: ['in_stock', 'made_to_order', 'discontinued', 'coming_soon'],
      default: 'in_stock',
    },

    leadTimeDays: { type: Number, default: 0 },

    // ─── Flags ─────────────────────────────────────────────────────────────
    // If true, shown as a selectable add-on inside the configurator
    isConfiguratorOption: { type: Boolean, default: false },
    // If true, shown in the accessories cross-sell section on PDP
    isCrossSell: { type: Boolean, default: true },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    // SEO
    metaTitle: translatableField(),
    metaDescription: translatableField(),
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
accessorySchema.index({ sku: 1 });
accessorySchema.index({ compatibleProductTypes: 1 });
accessorySchema.index({ isActive: 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
accessorySchema.pre('save', function () {
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(this.name.en);
  }
});

const Accessory = mongoose.model('Accessory', accessorySchema);

module.exports = Accessory;
