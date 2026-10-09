const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * ProductContent — per-product editable content modules shown on the PDP.
 *
 * One document per Product. Stores the extra rich-content blocks that
 * differ per product (frame features, fabric details, installation types, etc.)
 *
 * Which modules are SHOWN is driven by ProductType.activeModules — not here.
 * This model just stores the content for each module.
 */

// ─── Installation type sub-doc ────────────────────────────────────────────────
const installTypeSchema = new mongoose.Schema(
  {
    name:        translatableField({ required: true }),
    description: translatableField(),
    imageUrl:    { type: String, default: '' },
    // Only valid mount types for this product (must be in attributes.mount_type options)
    mountTypes:  [{ type: String }],
    isActive:    { type: Boolean, default: true },
    sortOrder:   { type: Number, default: 0 },
  },
  { _id: true }
);

// ─── Warranty tier sub-doc ────────────────────────────────────────────────────
const warrantyTierSchema = new mongoose.Schema(
  {
    component:   translatableField({ required: true }),  // e.g. "Frame", "Fabric", "Motor"
    years:       { type: Number, required: true },
    description: translatableField(),
  },
  { _id: false }
);

const productContentSchema = new mongoose.Schema(
  {
    product: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Product',
      required: true,
      unique:   true,
    },

    // ─── Specifications ───────────────────────────────────────────────────────
    // Extra spec notes shown below the attribute table
    specNotes: translatableField(),

    // ─── Operation / Motorization ─────────────────────────────────────────────
    operationOverview: translatableField(),  // rich text
    motorBrands:       [{ type: String }],   // e.g. ['Somfy', 'Nice']
    motorNotes:        translatableField(),

    // ─── Frame features ───────────────────────────────────────────────────────
    frameOverview:    translatableField(),
    frameFeatures: [
      {
        icon:        { type: String, default: '' },
        heading:     translatableField(),
        description: translatableField(),
        _id: false,
      },
    ],

    // ─── Fabric / Valance / Thread ────────────────────────────────────────────
    fabricOverview:   translatableField(),
    valanceOptions:   translatableField(),
    threadColors:     translatableField(),
    fabricNotes:      translatableField(),

    // ─── Heat sealing (pergolas, shade sails) ─────────────────────────────────
    heatSealingDescription: translatableField(),
    heatSealingImageUrl:    { type: String, default: '' },

    // ─── Installation types ───────────────────────────────────────────────────
    installationTypes: [installTypeSchema],

    // ─── Warranty ─────────────────────────────────────────────────────────────
    warrantyOverview: translatableField(),
    warrantyTiers:    [warrantyTierSchema],
    warrantyPdfUrl:   { type: String, default: '' },

    // ─── Financing estimate slot ──────────────────────────────────────────────
    // Static fallback text shown until the financing adapter is live (Prompt 1.16)
    financingNote: translatableField(),

    // ─── Custom intro ─────────────────────────────────────────────────────────
    // Shown above the first content module on the PDP
    productIntro: translatableField(),
  },
  { timestamps: true }
);


const ProductContent = mongoose.model('ProductContent', productContentSchema);
module.exports = ProductContent;
