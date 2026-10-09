const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * SegmentPage — a landing page for one of the 14 market segments.
 *
 * Linked 1:1 to a Segment document.
 * Staff can edit content blocks, product recommendations, testimonials,
 * project features, and SEO fields without a developer.
 *
 * The enquiry form is routed based on segment.audience (commercial vs consumer).
 */

// Content block sub-schema (reusable across segments)
const contentBlockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['rich_text', 'image', 'video', 'cta_banner', 'stats_row', 'testimonial'],
      default: 'rich_text',
    },
    heading:   translatableField(),
    body:      translatableField(),
    imageUrl:  { type: String, default: '' },
    imageAlt:  translatableField(),
    videoUrl:  { type: String, default: '' },
    ctaLabel:  translatableField(),
    ctaUrl:    { type: String, default: '' },
    stats: [
      {
        value: { type: String, default: '' },
        label: translatableField(),
        _id:   false,
      },
    ],
    sortOrder: { type: Number, default: 0 },
    isActive:  { type: Boolean, default: true },
  }
);

const segmentPageSchema = new mongoose.Schema(
  {
    // ─── Link to Segment ──────────────────────────────────────────────────────
    segment: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Segment',
      required: true,
      unique: true,
    },

    // Slug mirrors segment slug — kept in sync on save
    slug: {
      type:     String,
      required: true,
      unique:   true,
      lowercase: true,
      trim:     true,
    },

    // ─── Hero ─────────────────────────────────────────────────────────────────
    heroHeadline:    translatableField(),
    heroSubheadline: translatableField(),
    heroImageUrl:    { type: String, default: '' },
    heroImageAlt:    translatableField(),
    heroCta: {
      label: translatableField(),
      url:   { type: String, default: '' },
    },

    // ─── Content blocks ───────────────────────────────────────────────────────
    contentBlocks: [contentBlockSchema],

    // ─── Product recommendations ──────────────────────────────────────────────
    // Admin-mapped products for this segment
    featuredProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    // Max products to show on the page
    productLimit: { type: Number, default: 6 },

    // ─── Projects / testimonials ──────────────────────────────────────────────
    featuredProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],

    testimonials: [
      {
        quote:       translatableField(),
        authorName:  { type: String, default: '' },
        authorTitle: { type: String, default: '' },
        company:     { type: String, default: '' },
        avatarUrl:   { type: String, default: '' },
        rating:      { type: Number, min: 1, max: 5, default: 5 },
        sortOrder:   { type: Number, default: 0 },
        isActive:    { type: Boolean, default: true },
      },
    ],

    // ─── Enquiry form routing ─────────────────────────────────────────────────
    // Overrides segment.audience for form routing if needed
    enquiryQueue: {
      type: String,
      enum: ['consumer', 'commercial', ''],
      default: '',
    },

    // ─── Internal links ───────────────────────────────────────────────────────
    relatedSegments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Segment' }],

    // ─── SEO ──────────────────────────────────────────────────────────────────
    metaTitle:       translatableField(),
    metaDescription: translatableField(),
    canonicalUrl:    { type: String, default: '' },

    // ─── Status ───────────────────────────────────────────────────────────────
    status:   { type: String, enum: ['draft', 'published'], default: 'draft' },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON:  { virtuals: true },
    toObject:{ virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
segmentPageSchema.index({ slug: 1 });
segmentPageSchema.index({ segment: 1 });
segmentPageSchema.index({ status: 1, isActive: 1 });

// ─── Pre-save: sync slug from segment if missing ──────────────────────────────
segmentPageSchema.pre('save', function () {
  if (!this.slug && this.segment) {
    // Slug set by controller after loading segment doc
  }
});

const SegmentPage = mongoose.model('SegmentPage', segmentPageSchema);

module.exports = SegmentPage;
