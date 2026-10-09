const NavMenu   = require('../../models/NavMenu');
const Category  = require('../../models/Category');
const { createError } = require('../../middlewares/errorHandler');
const {
  isPayloadEditorialSource,
  getGlobal,
  mapNavigation,
  mapMobileNavigation,
} = require('../../services/payloadPublicContent');
const { createPayloadCatalog, mapCategory } = require('../../services/payloadCatalog');

const payloadCatalog = createPayloadCatalog();

/**
 * buildMegaMenu — merges live catalog categories with DB overrides.
 *
 * The "Products" top-level item has autoCatalog: true.
 * When a new category is seeded, it appears automatically in the mega menu
 * because this function fetches active categories from the DB and merges them
 * with any staff-configured overrides (custom imagery, extra links).
 */
const buildMegaMenu = async (menuItems) => {
  const result = [];

  for (const item of menuItems) {
    if (!item.autoCatalog) {
      result.push(item);
      continue;
    }

    // Fetch live categories
    const categories = await Category.find({ isActive: true })
      .sort('sortOrder')
      .populate('productTypes', 'name slug code')
      .lean();

    // Build columns from categories, merging any DB override by category._id
    const overrideMap = {};
    (item.children || []).forEach((col) => {
      if (col.category) {
        overrideMap[col.category.toString()] = col;
      }
    });

    const autoChildren = categories.map((cat) => {
      const override = overrideMap[cat._id.toString()] || {};
      return {
        heading:   override.heading || cat.name,
        category:  cat._id,
        url:       override.url || `/category/${cat.slug}`,
        image:     override.image || (cat.image && cat.image.url ? cat.image : { url: '', alt: { en: '' } }),
        children:  override.children || [],
        isActive:  override.isActive !== undefined ? override.isActive : true,
        sortOrder: override.sortOrder !== undefined ? override.sortOrder : (cat.sortOrder || 0),
      };
    });

    // Add any non-category override columns (custom entries)
    const customChildren = (item.children || []).filter((col) => !col.category);

    result.push({
      ...item,
      children: [...autoChildren, ...customChildren].sort((a, b) => a.sortOrder - b.sortOrder),
    });
  }

  return result;
};

// ─── Public: get main nav ─────────────────────────────────────────────────────
const getMainNav = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const [navigation, categoryDocs] = await Promise.all([
        getGlobal('navigation', (global) => global),
        payloadCatalog.getCategories({ depth: 3 }),
      ]);
      const categories = categoryDocs
        .filter((category) => category.isActive !== false)
        .map(mapCategory);
      const menu = mapNavigation(navigation, categories);
      return res.json({ success: true, data: menu });
    }

    const menu = await NavMenu.findOne({ type: 'main', isActive: true })
      .populate('items.children.category', 'name slug image')
      .lean();

    if (!menu) {
      return res.json({ success: true, data: { type: 'main', items: [] } });
    }

    const activeItems = (menu.items || []).filter((i) => i.isActive);
    const builtItems  = await buildMegaMenu(activeItems);

    res.json({ success: true, data: { ...menu, items: builtItems } });
  } catch (err) {
    next(err);
  }
};

// ─── Public: get mobile nav ───────────────────────────────────────────────────
const getMobileNav = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const menu = await getGlobal('navigation', mapMobileNavigation);
      return res.json({ success: true, data: menu });
    }

    const menu = await NavMenu.findOne({ type: 'mobile', isActive: true }).lean();

    if (!menu) {
      // Fall back to main nav structure simplified
      const main = await NavMenu.findOne({ type: 'main', isActive: true }).lean();
      if (!main) {return res.json({ success: true, data: { type: 'mobile', items: [] } });}

      const simplified = (main.items || [])
        .filter((i) => i.isActive)
        .map((i) => ({
          label:    i.label,
          url:      i.url,
          children: (i.children || [])
            .filter((c) => c.isActive)
            .map((c) => ({ label: c.heading, url: c.url, children: c.children || [] })),
          sortOrder: i.sortOrder,
        }));

      return res.json({ success: true, data: { type: 'mobile', items: simplified } });
    }

    res.json({ success: true, data: menu });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: get / upsert a menu ───────────────────────────────────────────────
const adminGetMenu = async (req, res, next) => {
  try {
    const { type } = req.params;
    const menu = await NavMenu.findOne({ type })
      .populate('items.children.category', 'name slug')
      .lean();

    if (!menu) {return next(createError(404, `Menu type '${type}' not found.`));}
    res.json({ success: true, data: menu });
  } catch (err) {
    next(err);
  }
};

const adminUpsertMenu = async (req, res, next) => {
  try {
    const { type } = req.params;
    const allowed = ['main', 'mobile', 'footer_primary', 'footer_secondary'];
    if (!allowed.includes(type)) {
      return next(createError(400, `Invalid menu type. Allowed: ${allowed.join(', ')}`));
    }

    const menu = await NavMenu.findOneAndUpdate(
      { type },
      { $set: { ...req.body, type } },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ success: true, data: menu });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMainNav, getMobileNav, adminGetMenu, adminUpsertMenu };
