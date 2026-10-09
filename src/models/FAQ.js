const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * FAQ — single store for all FAQs across the site.
 *
 * Tagged so they can appear in:
 *  - Support center (general tag)
 *  - Product detail page (product or product-type tag)
 *  - Segment landing page (segment tag)
 *
 * One FAQ document can appear in multiple contexts.
 */
const faqSchema = new mongoose.Schema(
  {
    question: translatableField({ required: true }),
    answer: translatableField({ required: true }),

    // ─── Tagging ───────────────────────────────────────────────────────────
    // Context tags — can be combined
    tags: {
      type: [String],
      enum: ['general', 'product', 'product_type', 'model', 'segment', 'shipping',
             'payment', 'warranty', 'installation', 'returns'],
      default: ['general'],
    },

    // Narrow to specific products, product types, or segments
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    productTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],
    segments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Segment' }],

    // ─── Schema.org FAQPage / Question support ────────────────────────────
    // Auto-included in FAQ JSON-LD when includeInSchema: true
    includeInSchema: { type: Boolean, default: true },

    // ─── Moderation ────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'published',
    },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
faqSchema.index({ tags: 1 });
faqSchema.index({ products: 1 });
faqSchema.index({ productTypes: 1 });
faqSchema.index({ status: 1, isActive: 1 });

const FAQ = mongoose.model('FAQ', faqSchema);

module.exports = FAQ;
