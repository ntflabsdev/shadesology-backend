'use strict';

/**
 * Comparison controller.
 *
 * Compares up to 4 variant/product combinations side-by-side.
 * Rows are generated from the shared AttributeDefinition schema so the
 * comparison table always reflects the correct attributes — no hard-coding.
 *
 * Difference highlighting: a row is flagged `hasDifference=true` when the
 * values across the compared variants are not all identical.
 *
 * Cross-category comparisons: included attributes are the UNION of attributes
 * that appear in any of the compared product types. Cells for product types
 * that don't have a particular attribute show null.
 *
 * Shareable link: the frontend appends `?ids=v1,v2,v3` — the API accepts
 * either `variantIds` (comma-separated) or JSON body.
 */

const Product             = require('../../models/Product');
const Variant             = require('../../models/Variant');
const AttributeDefinition = require('../../models/AttributeDefinition');
const { createError }     = require('../../middlewares/errorHandler');
const pricing             = require('@shadesology/pricing');
const { resolvePricingUser } = require('../../services/commercialPricing');

// ─── GET /api/compare?ids=v1,v2,v3 ──────────────────────────────────────────
const compare = async (req, res, next) => {
  try {
    const rawIds = (req.query.ids || '').split(',').map((id) => id.trim()).filter(Boolean);

    if (rawIds.length < 1) return next(createError(400, 'At least 1 variant ID is required (ids query param).'));
    if (rawIds.length > 4) return next(createError(400, 'Maximum 4 variants can be compared at once.'));

    // ── 1. Load variants + products ─────────────────────────────────────────
    const variants = await Variant.find({ _id: { $in: rawIds }, isActive: true })
      .populate({
        path: 'product',
        select: 'name slug images productType category manufacturer attributes fabrics colors isActive showPrice',
        populate: [
          { path: 'productType', select: 'name slug code' },
          { path: 'category', select: 'name slug' },
          { path: 'manufacturer', select: 'name slug' },
        ],
      })
      .lean();

    if (variants.length === 0) return next(createError(404, 'No matching variants found.'));

    // Filter out variants whose product is inactive
    const active = variants.filter((v) => v.product?.isActive !== false);
    if (active.length === 0) return next(createError(404, 'No active products to compare.'));

    // ── 2. Collect product type IDs across all compared items ───────────────
    const productTypeIds = [...new Set(
      active
        .map((v) => v.product?.productType?._id?.toString())
        .filter(Boolean)
    )];

    // ── 3. Load attribute definitions for ALL involved product types ─────────
    const attrDefs = await AttributeDefinition.find({
      $or: [
        { productTypes: { $in: productTypeIds } },
        { productTypes: { $size: 0 } }, // global attributes (no type restriction)
      ],
      useInComparison: true,
    })
      .sort({ sortOrder: 1 })
      .lean();

    // ── 4. Build comparison rows ─────────────────────────────────────────────
    const rows = attrDefs.map((attr) => {
      const values = active.map((v) => {
        const product = v.product;
        // Attributes are stored as a Map on the Product
        const attrMap = product?.attributes;
        let value = null;

        if (attrMap) {
          // Mongoose lean() converts Maps to plain objects
          value = attrMap instanceof Map
            ? attrMap.get(attr.key)
            : (attrMap[attr.key] ?? null);
        }

        // For range-type attributes, also check variant dimensions
        if (!value && attr.key === 'width_range') {
          value = v.widthMin && v.widthMax ? `${v.widthMin}–${v.widthMax}"` : null;
        }
        if (!value && attr.key === 'projection_range') {
          value = v.projectionMin && v.projectionMax ? `${v.projectionMin}–${v.projectionMax}"` : null;
        }
        if (!value && attr.key === 'lead_time_days') {
          value = v.leadTimeDays ? `${v.leadTimeDays} days` : null;
        }

        return value ?? null;
      });

      // Determine whether any values differ (null counts as different from a value)
      const nonNull    = values.filter((v) => v !== null);
      const hasDifference = nonNull.length > 0 &&
        nonNull.some((v) => String(v) !== String(nonNull[0]));

      return {
        key:           attr.key,
        label:         attr.name,
        unit:          attr.unit ?? null,
        type:          attr.type,
        values,
        hasDifference,
        showOnPdp:     attr.showOnPdp,
        group:         attr.group ?? null,
      };
    });

    // Remove rows where ALL values are null (attribute not relevant to any compared item)
    const filteredRows = rows.filter((r) => r.values.some((v) => v !== null));

    // ── 5. Apply price visibility per user ──────────────────────────────────
    const user = await resolvePricingUser(req.user || null);
    const items = active.map((v) => {
      const { displayPrice, priceType } = pricing.resolvePriceForUser(
        v.basePrice,
        v.priceTiers || [],
        user
      );
      return {
        variantId:   v._id,
        variantName: v.name,
        sku:         v.sku,
        availability: v.availability,
        leadTimeDays: v.leadTimeDays,
        displayPrice: v.product?.showPrice ? displayPrice : null,
        priceType:   v.product?.showPrice ? priceType : 'quote',
        product: {
          _id:          v.product._id,
          name:         v.product.name,
          slug:         v.product.slug,
          image:        v.product.images?.[0] ?? null,
          category:     v.product.category,
          productType:  v.product.productType,
          manufacturer: v.product.manufacturer,
        },
      };
    });

    // ── 6. Preserve original order from the request ─────────────────────────
    items.sort((a, b) =>
      rawIds.indexOf(a.variantId.toString()) - rawIds.indexOf(b.variantId.toString())
    );

    res.json({
      success: true,
      data: {
        items,
        rows: filteredRows,
        isCrossCategory: productTypeIds.length > 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { compare };
