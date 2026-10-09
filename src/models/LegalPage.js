const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * LegalPage — stores editable legal / content pages.
 *
 * Pages: privacy, terms, refunds, accessibility, cookie-policy, shipping-policy
 * Also used for generic CMS content pages (about, contact, etc.)
 *
 * Staff edit content in /admin. Frontend renders via slug.
 */
const legalPageSchema = new mongoose.Schema(
  {
    // Internal key — never changes (used in code for legal links)
    key: {
      type:     String,
      required: true,
      unique:   true,
      lowercase:true,
      trim:     true,
      // e.g. 'privacy', 'terms', 'refunds', 'accessibility', 'cookie-policy'
    },

    slug: {
      type:     String,
      required: true,
      unique:   true,
      lowercase:true,
      trim:     true,
    },

    title:           translatableField({ required: true }),
    content:         translatableField({ required: true }),  // rich HTML / markdown
    metaTitle:       translatableField(),
    metaDescription: translatableField(),

    // When content was last meaningfully updated (shown to users)
    lastReviewedAt: { type: Date, default: null },

    // noindex for any pages not meant for search engines
    noindex: { type: Boolean, default: false },

    // Page type — controls template rendering
    pageType: {
      type: String,
      enum: ['legal', 'content', 'contact', 'about'],
      default: 'legal',
    },

    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

legalPageSchema.index({ slug: 1 });
legalPageSchema.index({ key: 1 });

legalPageSchema.pre('save', function () {
  if (!this.slug && this.key) {
    this.slug = slugify(this.key);
  }
});

const LegalPage = mongoose.model('LegalPage', legalPageSchema);
module.exports = LegalPage;
