const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * HomepageSection — a single reorderable, toggleable block on the homepage.
 *
 * Section types:
 *   hero              — full-width hero with two CTA slots
 *   product_overview  — grid of product type cards (reads from ProductType)
 *   segments_grid     — 14 market segment tiles (reads from Segment)
 *   featured_products — admin-curated product cards
 *   featured_projects — reads from Project model (empty state handled in frontend)
 *   trust_band        — certifications, warranty, static review counts
 *   installer_locator — postcode entry → installer search / contact fallback
 *   custom_html       — arbitrary rich content block for one-off sections
 *
 * Staff can reorder sections by updating sortOrder and toggle visibility via isActive.
 * New category seeded → product_overview section picks it up automatically (data-driven).
 */

const ctaSchema = new mongoose.Schema(
  {
    label: translatableField(),
    url:   { type: String, default: '' },
    style: { type: String, enum: ['primary', 'secondary', 'outline'], default: 'primary' },
  },
  { _id: false }
);

const homepageSectionSchema = new mongoose.Schema(
  {
    // ─── Type ─────────────────────────────────────────────────────────────────
    type: {
      type: String,
      required: true,
      enum: [
        'hero',
        'product_overview',
        'segments_grid',
        'featured_products',
        'featured_projects',
        'trust_band',
        'installer_locator',
        'custom_html',
      ],
    },

    // Internal label shown in admin panel
    adminLabel: { type: String, required: true, trim: true },

    // ─── Hero fields ──────────────────────────────────────────────────────────
    headline:    translatableField(),
    subheadline: translatableField(),

    // Two editable CTA slots
    cta1: ctaSchema,
    cta2: ctaSchema,

    // Background media
    backgroundImage: {
      url:    { type: String, default: '' },
      alt:    translatableField(),
      mobileUrl: { type: String, default: '' },
    },
    backgroundVideoUrl: { type: String, default: '' },

    // ─── Featured products ────────────────────────────────────────────────────
    // Admin-curated product references (used by featured_products type)
    featuredProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // Max items to show (frontend uses this for grid sizing)
    itemLimit: { type: Number, default: 6 },

    // ─── Trust band fields ────────────────────────────────────────────────────
    trustItems: [
      {
        icon:      { type: String, default: '' },
        label:     translatableField(),
        value:     translatableField(),
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    // ─── Custom HTML / rich text ──────────────────────────────────────────────
    content: translatableField(),

    // ─── Section title (shown above section) ─────────────────────────────────
    sectionTitle:    translatableField(),
    sectionSubtitle: translatableField(),

    // ─── Display settings ─────────────────────────────────────────────────────
    sortOrder:        { type: Number, default: 0 },
    isActive:         { type: Boolean, default: true },
    backgroundColor:  { type: String, default: '' }, // CSS value e.g. '#f5f5f5'
    paddingVariant:   { type: String, enum: ['sm', 'md', 'lg', 'none'], default: 'md' },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
homepageSectionSchema.index({ isActive: 1, sortOrder: 1 });
homepageSectionSchema.index({ type: 1 });

const HomepageSection = mongoose.model('HomepageSection', homepageSectionSchema);

module.exports = HomepageSection;
