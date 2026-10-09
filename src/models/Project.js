const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * Project — a completed installation project used in the gallery and case studies.
 * Placeholder in Phase 1; fully built out in Phase 3.
 *
 * Fields:
 *  - Location (city, state, country)
 *  - Products used
 *  - Installer attribution
 *  - Before/after images
 *  - 14 segment categorisation
 *  - Case study fields (challenge, solution, results)
 */
const projectSchema = new mongoose.Schema(
  {
    title: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: translatableField(),

    // ─── Location ──────────────────────────────────────────────────────────
    location: {
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      country: { type: String, trim: true, default: 'US' },
    },

    // ─── Classification ────────────────────────────────────────────────────
    segments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Segment' }],
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // ─── Installer ─────────────────────────────────────────────────────────
    installer: { type: mongoose.Schema.Types.ObjectId, ref: 'Installer', default: null },
    installerName: { type: String, default: '' }, // fallback if installer not in system
    installerProfileUrl: {
      type: String,
      default: '',
      validate: {
        validator(value) {
          if (!value) {return true;}
          if (/^\/find-installer\/[a-z0-9-]+$/i.test(value)) {return true;}
          try {
            return new URL(value).protocol === 'https:';
          } catch {
            return false;
          }
        },
        message: 'Installer profile URL must be an internal installer path or HTTPS URL.',
      },
    },

    // ─── Media ─────────────────────────────────────────────────────────────
    images: [
      {
        url: { type: String, required: true },
        alt: translatableField(),
        isBefore: { type: Boolean, default: false },
        isAfter: { type: Boolean, default: false },
        isHero: { type: Boolean, default: false },
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    // ─── Case study fields (Phase 3) ───────────────────────────────────────
    challenge: translatableField(),
    solution: translatableField(),
    budget: translatableField(),
    results: translatableField(),
    energySavings: translatableField(),

    // Quantified metrics e.g. [{ label: "Energy savings", value: "30%", unit: "" }]
    metrics: [
      {
        label: translatableField(),
        value: { type: String, default: '' },
        unit: { type: String, default: '' },
        _id: false,
      },
    ],

    // Project size (sq ft)
    areaSqFt: { type: Number, default: null },

    // ─── SEO ───────────────────────────────────────────────────────────────
    metaTitle: translatableField(),
    metaDescription: translatableField(),

    // ─── Flags ─────────────────────────────────────────────────────────────
    isFeatured: { type: Boolean, default: false },    // shows on homepage
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },

    sortOrder: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
projectSchema.index({ segments: 1 });
projectSchema.index({ products: 1 });
projectSchema.index({ isFeatured: 1, status: 1 });
projectSchema.index({ 'location.state': 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
projectSchema.pre('save', function () {
  if (!this.slug && this.title && this.title.en) {
    this.slug = slugify(this.title.en);
  }
});

const Project = mongoose.model('Project', projectSchema);

module.exports = Project;
