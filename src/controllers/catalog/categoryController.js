const Category        = require('../../models/Category');
const CategoryContent = require('../../models/CategoryContent');
const Product         = require('../../models/Product');
const Variant         = require('../../models/Variant');
const { createError } = require('../../middlewares/errorHandler');
const {
  getFilterDefinitions,
  buildProductFilter,
  buildFacetsResponse,
  getIndexationRule,
  parseActiveFilters,
} = require('../../utils/filterBuilder');
const {
  isPayloadEditorialSource,
  publishedReadFilter,
} = require('../../services/payloadPublicContent');
const {
  createPayloadCatalog,
  mapCategory: mapPayloadCategory,
  mapProductCard,
  matchesAttribute,
  sortProducts,
  toId,
  richText,
} = require('../../services/payloadCatalog');
const { addPayloadPrices } = require('./productController');

const payloadCatalog = createPayloadCatalog();

const getPayloadCategoryPage = async (slug, query) => {
  const sourceCategory = await payloadCatalog.getCategory(slug);
  if (!sourceCategory) {return null;}
  const category = mapPayloadCategory(sourceCategory);
  const [categoryContent, definitions, catalogProducts] = await Promise.all([
    payloadCatalog.getCategoryContent(toId(sourceCategory.id || sourceCategory._id)),
    payloadCatalog.getAttributeDefinitions(),
    payloadCatalog.getProducts({ depth: 3 }),
  ]);
  const typeIds = (sourceCategory.productTypes || []).map(toId);
  const attrDefs = definitions.filter((definition) =>
    !definition.productTypes?.length || definition.productTypes.some((type) => typeIds.includes(toId(type))));
  const filterQuery = { ...query };
  const sortValue = filterQuery.sort || DEFAULT_SORT;
  const pageNum = Math.max(1, Number.parseInt(filterQuery.page, 10) || 1);
  const limitNum = Math.min(96, Math.max(1, Number.parseInt(filterQuery.limit, 10) || 24));
  delete filterQuery.sort;
  delete filterQuery.page;
  delete filterQuery.limit;
  const activeFilters = parseActiveFilters(filterQuery, attrDefs);
  const products = catalogProducts.filter((product) =>
    product.isActive !== false &&
    (toId(product.category) === toId(sourceCategory.id || sourceCategory._id) ||
      product.category?.slug === slug) &&
    attrDefs.every((definition) =>
      matchesAttribute(product.attributes?.[definition.key], activeFilters[definition.key], definition)));
  const cmsVariants = await payloadCatalog.getVariantsForProducts(products.map((product) => toId(product.id || product._id)));
  const productCards = await addPayloadPrices(products, cmsVariants);
  const cardById = new Map(productCards.map((card) => [card._id, card]));
  const sortKey = SORT_MAP[sortValue] !== undefined ? sortValue : DEFAULT_SORT;
  let sortedProducts;
  if (sortKey === 'price_asc' || sortKey === 'price_desc') {
    sortedProducts = [...products].sort((left, right) => {
      const leftPrice = cardById.get(toId(left.id || left._id))?.priceFrom;
      const rightPrice = cardById.get(toId(right.id || right._id))?.priceFrom;
      const missing = sortKey === 'price_asc' ? Infinity : -Infinity;
      return sortKey === 'price_asc'
        ? (leftPrice ?? missing) - (rightPrice ?? missing)
        : (rightPrice ?? missing) - (leftPrice ?? missing);
    });
  } else {
    sortedProducts = sortProducts(products, sortKey);
  }
  const total = sortedProducts.length;
  const pageProducts = sortedProducts
    .slice((pageNum - 1) * limitNum, pageNum * limitNum)
    .map((product) => cardById.get(toId(product.id || product._id)) || mapProductCard(product));
  const content = categoryContent ? {
    ...categoryContent,
    introContent: richText(categoryContent.introContent),
    outroContent: richText(categoryContent.outroContent),
  } : null;
  const crawlableKeys = Array.isArray(categoryContent?.crawlableFilterKeys)
    ? categoryContent.crawlableFilterKeys
    : [];
  const seo = getIndexationRule(crawlableKeys, activeFilters, `/category/${slug}`);
  return {
    category,
    content,
    products: pageProducts,
    facets: buildFacetsResponse(attrDefs, activeFilters),
    activeFilters,
    sort: sortKey,
    seo: { canonical: seo.canonical, noindex: !seo.index },
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  };
};

// ─── Allowed sort options ─────────────────────────────────────────────────────
const SORT_MAP = {
  'sortOrder':    { sortOrder: 1 },
  'price_asc':    null,          // handled via Variant lookup
  'price_desc':   null,
  'newest':       { createdAt: -1 },
  'name_asc':     { 'name.en': 1 },
  'name_desc':    { 'name.en': -1 },
  'popular':      { viewCount: -1 },
};
const DEFAULT_SORT = 'sortOrder';

// ─── Public: list all active categories ───────────────────────────────────────
const listCategories = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const docs = await payloadCatalog.getCategories({ depth: 3 });
      const categories = docs
        .filter((category) => category.isActive !== false)
        .map(mapPayloadCategory)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      return res.json({ success: true, data: categories });
    }

    const categories = await Category.find({ isActive: true })
      .select('name slug description image sortOrder productTypes')
      .populate('productTypes', 'name slug code')
      .sort('sortOrder')
      .lean();

    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
};

// ─── Public: get one category + filtered product grid ─────────────────────────
const getCategoryPage = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const {
      sort    = DEFAULT_SORT,
      page    = 1,
      limit   = 24,
      ...queryRest
    } = req.query;

    if (isPayloadEditorialSource()) {
      const data = await getPayloadCategoryPage(slug, req.query);
      if (!data) {return next(createError(404, 'Category not found.'));}
      return res.json({ success: true, data });
    }

    // ── 1. Load category ──────────────────────────────────────────────────────
    const category = await Category.findOne(publishedReadFilter({ slug, isActive: true }))
      .populate('productTypes', 'name slug code activeModules')
      .lean();

    if (!category) {return next(createError(404, 'Category not found.'));}

    // ── 2. Load CMS content ───────────────────────────────────────────────────
    const content = await CategoryContent.findOne({ category: category._id }).lean();

    // ── 3. Load filter definitions for this category's product types ──────────
    const productTypeIds = (category.productTypes || []).map((pt) => pt._id);
    const firstTypeId    = productTypeIds[0] || null;
    const attrDefs       = await getFilterDefinitions(firstTypeId);

    // ── 4. Parse active filters from query params ─────────────────────────────
    const activeFilters = parseActiveFilters(queryRest, attrDefs);

    // ── 5. Build Mongoose filter ──────────────────────────────────────────────
    const attrFilter  = buildProductFilter(activeFilters, attrDefs);
    const baseFilter  = publishedReadFilter({
      category: category._id,
      isActive: true,
      ...attrFilter,
    });

    // ── 6. Pagination ─────────────────────────────────────────────────────────
    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(96, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    // ── 7. Sort ───────────────────────────────────────────────────────────────
    const sortKey   = SORT_MAP[sort] !== undefined ? sort : DEFAULT_SORT;
    const sortQuery = SORT_MAP[sortKey] || { sortOrder: 1 };

    // ── 8. Fetch products ─────────────────────────────────────────────────────
    const [products, total] = await Promise.all([
      Product.find(baseFilter)
        .select('name slug shortDescription images productType showPrice isFeatured isNewArrival attributes')
        .populate('productType', 'name slug')
        .sort(sortQuery)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(baseFilter),
    ]);

    // ── 9. Attach price range to each product (server-side visibility) ────────
    const productIds = products.map((p) => p._id);
    const variants   = await Variant.find(publishedReadFilter({
      product:      { $in: productIds },
      isActive:     true,
      availability: { $ne: 'discontinued' },
    }))
      .select('product basePrice priceTiers availability')
      .lean();

    // Map productId → min base price (retail — never expose dealer tiers here)
    const priceMap = {};
    for (const v of variants) {
      const pid = v.product.toString();
      if (!priceMap[pid] || v.basePrice < priceMap[pid]) {
        priceMap[pid] = v.basePrice;
      }
    }

    // Attach price to product (respects showPrice flag)
    const productsWithPrice = products.map((p) => ({
      ...p,
      priceFrom: p.showPrice ? (priceMap[p._id.toString()] || null) : null,
      // NEVER include priceTiers here — retail responses must not contain dealer pricing
    }));

    // ── 10. Indexation rules ──────────────────────────────────────────────────
    const baseCanonical = `/category/${slug}`;
    const crawlableKeys = content ? content.crawlableFilterKeys : [];
    const seo = getIndexationRule(crawlableKeys, activeFilters, baseCanonical);

    // ── 11. Build facets ──────────────────────────────────────────────────────
    const facets = buildFacetsResponse(attrDefs, activeFilters);

    res.json({
      success: true,
      data: {
        category,
        content:  content || null,
        products: productsWithPrice,
        facets,
        activeFilters,
        sort:     sortKey,
        seo,
        pagination: {
          page:  pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: CRUD for CategoryContent ─────────────────────────────────────────
const adminGetContent = async (req, res, next) => {
  try {
    const content = await CategoryContent.findOne({ category: req.params.categoryId })
      .populate('category', 'name slug')
      .lean();

    res.json({ success: true, data: content || null });
  } catch (err) {
    next(err);
  }
};

const adminUpsertContent = async (req, res, next) => {
  try {
    const { categoryId } = req.params;

    // Verify category exists
    const cat = await Category.findById(categoryId);
    if (!cat) {return next(createError(404, 'Category not found.'));}

    const content = await CategoryContent.findOneAndUpdate(
      { category: categoryId },
      { $set: { ...req.body, category: categoryId } },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ success: true, data: content });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: update crawlable filter keys ──────────────────────────────────────
const adminSetCrawlableFilters = async (req, res, next) => {
  try {
    const { crawlableFilterKeys } = req.body;
    if (!Array.isArray(crawlableFilterKeys)) {
      return next(createError(400, 'crawlableFilterKeys must be an array of strings.'));
    }

    const content = await CategoryContent.findOneAndUpdate(
      { category: req.params.categoryId },
      { $set: { crawlableFilterKeys } },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: { crawlableFilterKeys: content.crawlableFilterKeys } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listCategories,
  getCategoryPage,
  adminGetContent,
  adminUpsertContent,
  adminSetCrawlableFilters,
};
