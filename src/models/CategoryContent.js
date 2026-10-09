const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * CategoryContent — editable rich-content areas for category pages.
 *
 * One document per Category.
 * Staff edit buying-guidance copy and SEO content in /admin
 * without touching code or redeploying.
 *
 * Two editable zones:
 *   introContent  — shown ABOVE the product grid (brief intro / buying guide)
 *   outroContent  — shown BELOW the grid (detailed SEO copy, FAQ links)
 */
const categoryContentSchema = new mongoose.Schema(
  {
    category: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Category',
      required: true,
      unique:   true,
    },

    // ─── Above grid ──────────────────────────────────────────────────────────
    introHeading:   translatableField(),
    introContent:   translatableField(),  // rich HTML

    // ─── Below grid ──────────────────────────────────────────────────────────
    outroHeading:   translatableField(),
    outroContent:   translatableField(),  // rich HTML — longer SEO copy

    // ─── Buying guide links ───────────────────────────────────────────────────
    buyingGuideLinks: [
      {
        label: translatableField(),
        url:   { type: String, default: '' },
        _id:   false,
      },
    ],

    // ─── Comparison entry point ───────────────────────────────────────────────
    showComparisonCta: { type: Boolean, default: true },

    // ─── SEO ─────────────────────────────────────────────────────────────────
    metaTitle:       translatableField(),
    metaDescription: translatableField(),

    // ─── Indexation rules ─────────────────────────────────────────────────────
    // Which single-filter combinations are crawlable (get canonical URLs).
    // Everything else gets noindex + canonical pointing to the base category.
    //
    // Format: ['mount_type', 'operation']
    // Meaning: ?mount_type=X is crawlable, ?operation=Y is crawlable,
    //          ?mount_type=X&operation=Y is noindex.
    crawlableFilterKeys: { type: [String], default: [] },
  },
  { timestamps: true }
);


const CategoryContent = mongoose.model('CategoryContent', categoryContentSchema);
module.exports = CategoryContent;
