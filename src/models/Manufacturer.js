const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

const manufacturerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: translatableField(),

    logo: {
      url: { type: String, default: '' },
      alt: { type: String, default: '' },
    },

    website: { type: String, default: '' },
    country: { type: String, default: '' },

    // Certifications held by this manufacturer
    certifications: [
      {
        name: { type: String, required: true },
        number: { type: String, default: '' },
        issuedAt: { type: Date },
        expiresAt: { type: Date },
        documentUrl: { type: String, default: '' },
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
manufacturerSchema.index({ isActive: 1 });

// ─── Pre-save: auto-slug ──────────────────────────────────────────────────────
manufacturerSchema.pre('save', function () {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
});

// ─── Virtual: products by this manufacturer ───────────────────────────────────
manufacturerSchema.virtual('products', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'manufacturer',
});

const Manufacturer = mongoose.model('Manufacturer', manufacturerSchema);

module.exports = Manufacturer;
