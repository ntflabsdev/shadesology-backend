const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

/**
 * AttributeDefinition — schema-driven product attributes.
 *
 * A single document here automatically becomes:
 *  - A filter on the category page (if useAsFilter: true)
 *  - A row in the comparison table (if useInComparison: true)
 *  - A row in the specifications table on the PDP
 *
 * No code changes needed when a new attribute is added.
 */
const attributeDefinitionSchema = new mongoose.Schema(
  {
    name: translatableField({ required: true }),

    // Machine-readable key used in product attribute maps e.g. "mount_type"
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Data type of the attribute value
    type: {
      type: String,
      required: true,
      enum: ['text', 'number', 'boolean', 'select', 'multi_select', 'range', 'color'],
      default: 'text',
    },

    // Predefined options for select / multi_select types
    options: [
      {
        value: { type: String, required: true },
        label: translatableField(),
        _id: false,
      },
    ],

    // Unit of measure e.g. "ft", "in", "lbs", "mph"
    unit: { type: String, default: '' },

    // Imperial/metric pair — both stored, display depends on user preference
    unitMetric: { type: String, default: '' },

    // Which product types this attribute applies to (empty = all)
    productTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],

    // Filter settings
    useAsFilter: { type: Boolean, default: false },
    filterDisplayType: {
      type: String,
      enum: ['checkbox', 'range_slider', 'color_swatch', 'button_group'],
      default: 'checkbox',
    },

    // Comparison table
    useInComparison: { type: Boolean, default: true },

    // Specifications table on PDP
    showOnPdp: { type: Boolean, default: true },

    // Group heading for grouping specs on PDP e.g. "Dimensions", "Performance"
    group: translatableField(),

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
attributeDefinitionSchema.index({ useAsFilter: 1 });
attributeDefinitionSchema.index({ productTypes: 1 });
attributeDefinitionSchema.index({ isActive: 1, sortOrder: 1 });

// ─── Pre-save: auto-key from English name ────────────────────────────────────
attributeDefinitionSchema.pre('save', function () {
  if (!this.key && this.name && this.name.en) {
    this.key = slugify(this.name.en).replace(/-/g, '_');
  }
});

const AttributeDefinition = mongoose.model('AttributeDefinition', attributeDefinitionSchema);

module.exports = AttributeDefinition;
