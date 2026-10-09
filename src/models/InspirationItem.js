const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');
const slugify = require('../utils/slugify');

const inspirationItemSchema = new mongoose.Schema(
  {
    title: translatableField({ required: true }),
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    image: {
      url: { type: String, required: true, trim: true },
      alt: translatableField(),
    },
    style: { type: String, trim: true, index: true, default: '' },
    productType: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductType', default: null },
    setting: { type: String, trim: true, index: true, default: '' },
    color: { type: String, trim: true, index: true, default: '' },
    manufacturer: { type: mongoose.Schema.Types.ObjectId, ref: 'Manufacturer', default: null },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    isFeatured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    sortOrder: { type: Number, default: 0 },
    metaTitle: translatableField(),
    metaDescription: translatableField(),
  },
  { timestamps: true }
);

inspirationItemSchema.index({ status: 1, isActive: 1, sortOrder: 1 });

inspirationItemSchema.pre('save', function () {
  if (!this.slug && this.title?.en) {this.slug = slugify(this.title.en);}
});

module.exports = mongoose.model('InspirationItem', inspirationItemSchema);
