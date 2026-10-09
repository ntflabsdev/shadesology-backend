const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * NavMenu — stores the full navigation structure.
 *
 * Supports two menu types:
 *   main   — desktop mega menu (multi-level with product imagery)
 *   mobile — simplified tree for mobile drawer
 *
 * Structure:
 *   NavMenu (type: main)
 *   └── items[] (top-level nav items, e.g. "Products", "Inspiration")
 *       └── children[] (second-level columns)
 *           └── children[] (third-level links within a column)
 *
 * Product categories are auto-synced from the catalog — staff only need to
 * override imagery or add custom entries via the "override" flag.
 *
 * When a new category is seeded, it appears automatically in the mega menu
 * because the /api/nav endpoint merges DB overrides on top of live catalog data.
 */

// ── Third-level link ──────────────────────────────────────────────────────────
const navLinkSchema = new mongoose.Schema(
  {
    label:    translatableField({ required: true }),
    url:      { type: String, required: true },
    icon:     { type: String, default: '' },
    badge:    translatableField(),              // e.g. "New", "Sale"
    isActive: { type: Boolean, default: true },
    sortOrder:{ type: Number, default: 0 },
  },
  { _id: false }
);

// ── Second-level column / group ───────────────────────────────────────────────
const navColumnSchema = new mongoose.Schema(
  {
    heading:   translatableField(),
    // Link to a Category doc — if set, label/url auto-populate from catalog
    category:  { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    url:       { type: String, default: '' },
    image:     { url: { type: String, default: '' }, alt: translatableField() },
    children:  [navLinkSchema],
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

// ── Top-level item ────────────────────────────────────────────────────────────
const navItemSchema = new mongoose.Schema(
  {
    label:    translatableField({ required: true }),
    url:      { type: String, default: '' },
    // 'mega' = full-width dropdown with columns
    // 'dropdown' = simple list dropdown
    // 'link' = plain link, no dropdown
    type:     { type: String, enum: ['mega', 'dropdown', 'link'], default: 'link' },

    // If true, columns auto-populated from catalog categories
    // Staff can still add overrides in the children array
    autoCatalog: { type: Boolean, default: false },

    children:  [navColumnSchema],

    // CTAs shown inside the mega panel (e.g. "Get a Quote")
    ctas: [
      {
        label: translatableField(),
        url:   { type: String, default: '' },
        style: { type: String, enum: ['primary', 'secondary', 'outline'], default: 'primary' },
        _id:   false,
      },
    ],

    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

// ── Root schema ───────────────────────────────────────────────────────────────
const navMenuSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      unique: true,
      enum: ['main', 'mobile', 'footer_primary', 'footer_secondary'],
    },
    adminLabel: { type: String, required: true },
    items:      [navItemSchema],
    isActive:   { type: Boolean, default: true },
  },
  { timestamps: true }
);

navMenuSchema.index({ type: 1 });

const NavMenu = mongoose.model('NavMenu', navMenuSchema);
module.exports = NavMenu;
