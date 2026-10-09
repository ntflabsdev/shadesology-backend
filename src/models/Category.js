const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

const categorySchema = new mongoose.Schema(
  {
    // Translatable display name
    name: translatableField({ required: true }),

    // URL slug — auto-generated from name.en if not provided
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Self-referencing parent for hierarchy (null = top-level)
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },

    // Depth in tree: 0 = root, 1 = sub-category, etc.
    depth: { type: Number, default: 0 },

    // Materialized path for efficient ancestor queries e.g. ",root-id,parent-id,"
    path: { type: String, default: '' },

    description: translatableField(),

    // SEO
    metaTitle: translatableField(),
    metaDescription: translatableField(),

    // Category image
    image: {
      url: { type: String, default: '' },
      alt: translatableField(),
    },

    // Admin-controlled display order
    sortOrder: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },

    // Which product types belong in this category
    productTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });
categorySchema.index({ path: 1 });
categorySchema.index({ isActive: 1, sortOrder: 1 });

// ─── Pre-save: auto-generate slug from English name ──────────────────────────
categorySchema.pre('save', function () {
  if (!this.isModified('name') && this.slug) {
    return;
  }
  if (!this.slug && this.name && this.name.en) {
    this.slug = slugify(this.name.en);
  }
});

// ─── Virtual: child categories ───────────────────────────────────────────────
categorySchema.virtual('children', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent',
});

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
