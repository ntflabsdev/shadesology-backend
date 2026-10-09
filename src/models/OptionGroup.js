const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * OptionGroup — a group of selectable options for a product/configurator.
 * e.g. "Frame Color", "Motor Type", "Remote Control", "Valance Style"
 *
 * Options within the group carry surcharges applied by packages/pricing.
 * Surcharge types:
 *   fixed      — flat dollar amount added
 *   percent    — % of base price
 *   per_unit   — multiplied by quantity / dimension
 */

// ─── Sub-schema: individual option ───────────────────────────────────────────
const optionSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    // Machine-readable value stored in cart line items and orders
    value: { type: String, required: true, trim: true },

    description: translatableField(),

    // Surcharge applied when this option is selected
    surchargeType: {
      type: String,
      enum: ['none', 'fixed', 'percent', 'per_unit'],
      default: 'none',
    },
    surchargeAmount: { type: Number, default: 0 },

    // Image/icon for this option (e.g. color swatch, motor image)
    image: {
      url: { type: String, default: '' },
      alt: translatableField(),
    },

    // Linked color document (for color-type option groups)
    color: { type: mongoose.Schema.Types.ObjectId, ref: 'Color', default: null },

    // Availability
    isAvailable: { type: Boolean, default: true },
    availableFrom: { type: Date, default: null },

    sortOrder: { type: Number, default: 0 },
  }
);

// ─── Main schema: option group ────────────────────────────────────────────────
const optionGroupSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Display type in the configurator / PDP UI
    displayType: {
      type: String,
      enum: ['dropdown', 'radio', 'color_swatch', 'button_group', 'checkbox'],
      default: 'dropdown',
    },

    // Is selecting an option in this group mandatory?
    isRequired: { type: Boolean, default: false },

    // Allow selecting multiple options (e.g. accessories)
    allowMultiple: { type: Boolean, default: false },

    description: translatableField(),

    options: [optionSchema],

    // Which product types this group applies to (empty = all)
    productTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
optionGroupSchema.index({ productTypes: 1 });
optionGroupSchema.index({ isActive: 1, sortOrder: 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
optionGroupSchema.pre('save', function () {
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(this.name.en);
  }
});

const OptionGroup = mongoose.model('OptionGroup', optionGroupSchema);

module.exports = OptionGroup;
