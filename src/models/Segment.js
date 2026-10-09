const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * Segment — one of the 14 market segments.
 *
 * Residential:
 *   residential_home, residential_outdoor_living, residential_poolside,
 *   residential_balcony_terrace
 *
 * Commercial:
 *   commercial_hospitality, commercial_restaurant_cafe, commercial_retail,
 *   commercial_office, commercial_healthcare, commercial_education,
 *   commercial_government, commercial_sports_recreation,
 *   commercial_industrial, commercial_property_management
 */
const segmentSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Internal code — used in lead routing and email queues
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    // commercial | residential — drives quote routing
    audience: {
      type: String,
      enum: ['residential', 'commercial'],
      required: true,
    },

    description: translatableField(),

    // Hero image for the segment landing page
    heroImage: {
      url: { type: String, default: '' },
      alt: translatableField(),
    },

    // Icon (SVG string or icon-font class)
    icon: { type: String, default: '' },

    // Admin-curated product recommendations for this segment
    featuredProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // Editable content blocks for the segment landing page
    contentBlocks: [
      {
        type: {
          type: String,
          enum: ['rich_text', 'image', 'video', 'cta'],
          default: 'rich_text',
        },
        content: translatableField(),
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        _id: false,
      },
    ],

    // SEO
    metaTitle: translatableField(),
    metaDescription: translatableField(),

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
segmentSchema.index({ audience: 1 });
segmentSchema.index({ isActive: 1, sortOrder: 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
segmentSchema.pre('save', function () {
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(this.name.en);
  }
});

const Segment = mongoose.model('Segment', segmentSchema);

module.exports = Segment;
