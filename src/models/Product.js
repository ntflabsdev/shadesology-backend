const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * Product — a shade product listed on Shadesology.com.
 * Belongs to one Category and one ProductType.
 * Has multiple Variants (orderable models).
 *
 * All customer-facing text fields are translatable.
 * Attributes are stored as a key→value map driven by AttributeDefinition.
 */
const productSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // ─── Classification ────────────────────────────────────────────────────
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },

    productType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductType',
      required: true,
    },

    manufacturer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Manufacturer',
      default: null,
    },

    // Market segments this product is relevant to
    segments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Segment' }],

    // ─── Content ───────────────────────────────────────────────────────────
    shortDescription: translatableField(),
    description: translatableField(),

    // Key selling points / bullet features shown on PDP
    features: [
      {
        text: translatableField({ required: true }),
        _id: false,
      },
    ],

    // ─── Attributes ────────────────────────────────────────────────────────
    // Dynamic key→value map. Keys correspond to AttributeDefinition.key
    // e.g. { mount_type: 'wall', operation: 'motorized', wind_rating: '35' }
    attributes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ─── Media ─────────────────────────────────────────────────────────────
    images: [
      {
        url: { type: String, required: true },
        alt: translatableField(),
        type: {
          type: String,
          enum: ['photo', 'video_thumbnail', '360_spin'],
          default: 'photo',
        },
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    videoUrl: { type: String, default: '' },

    // 360 spin image set (array of ordered frame URLs)
    spinImages: [{ type: String }],

    // ─── Fabrics & Colors ──────────────────────────────────────────────────
    fabrics: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Fabric' }],
    colors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Color' }],

    // ─── Related ───────────────────────────────────────────────────────────
    // Admin-curated related products
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // Accessories (cross-sell items)
    accessories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // ─── SEO & Schema ──────────────────────────────────────────────────────
    metaTitle: translatableField(),
    metaDescription: translatableField(),

    // JSON-LD overrides (staff can supplement auto-generated schema)
    schemaOverrides: { type: Object, default: {} },

    // ─── Pricing display ───────────────────────────────────────────────────
    // Price range is derived at read time from Variants — not stored here
    // This flag controls whether price is shown or "request quote"
    showPrice: { type: Boolean, default: true },

    // ─── Flags ─────────────────────────────────────────────────────────────
    isFeatured: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false }, // renamed from isNew (Mongoose reserved)
    isActive: { type: Boolean, default: true },

    // Admin-set sort order within category
    sortOrder: { type: Number, default: 0 },

    // Track views for popularity sorting
    viewCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
productSchema.index({ slug: 1 });
productSchema.index({ category: 1 });
productSchema.index({ productType: 1 });
productSchema.index({ manufacturer: 1 });
productSchema.index({ segments: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ isActive: 1, sortOrder: 1 });
// Atlas Search index (configured via Atlas UI / CLI, not here)

// ─── Virtual: variants ────────────────────────────────────────────────────────
productSchema.virtual('variants', {
  ref: 'Variant',
  localField: '_id',
  foreignField: 'product',
});

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
productSchema.pre('save', function () {
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(this.name.en);
  }
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
