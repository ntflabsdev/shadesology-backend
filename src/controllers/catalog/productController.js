const Product        = require('../../models/Product');
const ProductContent = require('../../models/ProductContent');
const Variant        = require('../../models/Variant');
const Review         = require('../../models/Review');
const FAQ            = require('../../models/FAQ');
const Document       = require('../../models/Document');
const Video          = require('../../models/Video');
const { createError }= require('../../middlewares/errorHandler');
const { buildModuleVisibility } = require('../../utils/moduleRules');
const { buildProductJsonLd, buildBreadcrumbJsonLd } = require('../../utils/jsonLd');
const pricing = require('@shadesology/pricing');
const { resolvePricingUser } = require('../../services/commercialPricing');
const {
  isPayloadEditorialSource,
  publishedReadFilter,
} = require('../../services/payloadPublicContent');
const {
  createPayloadCatalog,
  mapProductCard,
  mapProduct,
  mapVariant,
  relationContains,
  toId,
  richText,
  sortProducts,
} = require('../../services/payloadCatalog');

const payloadCatalog = createPayloadCatalog();

const productMatchesPayloadFilters = (product, filters) => {
  if (filters.category && toId(product.category) !== String(filters.category) &&
      product.category?.slug !== filters.category) {return false;}
  if (filters.productType && toId(product.productType) !== String(filters.productType) &&
      product.productType?.slug !== filters.productType) {return false;}
  if (filters.featured && product.isFeatured !== true) {return false;}
  return true;
};

const addPayloadPrices = async (products, variants = null, user = null) => {
  const cmsVariants = variants || await payloadCatalog.getVariantsForProducts(products.map((product) => toId(product.id || product._id)));
  const skus = [...new Set(cmsVariants.map((variant) => variant.sku).filter(Boolean))];
  const commerceVariants = skus.length
    ? await Variant.find(publishedReadFilter({ sku: { $in: skus }, isActive: true }))
      .select('sku basePrice priceTiers availability')
      .lean()
    : [];
  const priceBySku = new Map();
  for (const variant of commerceVariants) {
    const current = priceBySku.get(variant.sku);
    const { displayPrice } = pricing.resolvePriceForUser(variant.basePrice, variant.priceTiers || [], user);
    if (variant.availability !== 'discontinued' && (current === undefined || displayPrice < current)) {
      priceBySku.set(variant.sku, displayPrice);
    }
  }
  const variantsByProduct = new Map();
  for (const variant of cmsVariants) {
    const productId = toId(variant.product);
    if (!variantsByProduct.has(productId)) {variantsByProduct.set(productId, []);}
    variantsByProduct.get(productId).push(variant);
  }
  return products.map((product) => {
    const id = toId(product.id || product._id);
    const prices = (variantsByProduct.get(id) || [])
      .filter((variant) => variant.availability !== 'discontinued')
      .map((variant) => priceBySku.get(variant.sku))
      .filter((price) => Number.isFinite(price));
    const card = mapProductCard(product);
    return { ...card, priceFrom: card.showPrice && prices.length ? Math.min(...prices) : null };
  });
};

const getPayloadProduct = async (slug, user) => {
  const payloadProduct = await payloadCatalog.getProduct(slug);
  if (!payloadProduct || payloadProduct.isActive === false) {return null;}
  const product = mapProduct(payloadProduct);
  const payloadVariants = (await payloadCatalog.getVariants(toId(payloadProduct.id || payloadProduct._id)))
    .map(mapVariant)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const skus = payloadVariants.map((variant) => variant.sku).filter(Boolean);
  const commerceVariants = skus.length
    ? await Variant.find(publishedReadFilter({ sku: { $in: skus }, isActive: true }))
      .populate('allowedOptionGroups')
      .lean()
    : [];
  const commerceBySku = new Map(commerceVariants.map((variant) => [variant.sku, variant]));
  const rawVariants = payloadVariants.map((variant) => {
    const commerce = commerceBySku.get(variant.sku);
    return commerce
      ? { ...variant, ...commerce, name: variant.name, dimensions: variant.dimensions, images: variant.images, allowedOptionGroups: commerce.allowedOptionGroups }
      : variant;
  });
  const variants = rawVariants.map((variant) =>
    sanitiseVariant(variant, product.showPrice, user)
  );
  const moduleVisibility = buildModuleVisibility(product.productType?.activeModules || []);
  const payloadProductContent = await payloadCatalog.getProductContent(toId(payloadProduct.id || payloadProduct._id));
  const content = payloadProductContent ? {
    ...payloadProductContent,
    productIntro: richText(payloadProductContent.productIntro),
    operationOverview: richText(payloadProductContent.operationOverview),
    frameOverview: richText(payloadProductContent.frameOverview),
    fabricOverview: richText(payloadProductContent.fabricOverview),
    warrantyOverview: richText(payloadProductContent.warrantyOverview),
    warrantyPdfUrl: null,
    heatSealingImageUrl: payloadProductContent.heatSealingImage?.url || payloadProductContent.heatSealingImageUrl || '',
  } : null;
  const [faqRecords, documentRecords] = await Promise.all([
    moduleVisibility.faq ? payloadCatalog.getPublished('faqs') : Promise.resolve([]),
    moduleVisibility.manuals ? payloadCatalog.getPublished('documents', { depth: 3 }) : Promise.resolve([]),
  ]);
  const faqs = faqRecords
    .filter((faq) =>
      relationContains(faq.products, payloadProduct.id || payloadProduct._id) ||
      (product.productType && relationContains(faq.productTypes, product.productType._id)))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    .map((faq) => ({
      _id: toId(faq.id || faq._id),
      question: richText(faq.question),
      answer: richText(faq.answer),
      sortOrder: faq.sortOrder || 0,
    }));
  const now = Date.now();
  const manuals = documentRecords
    .filter((document) =>
      document.isActive !== false &&
      (relationContains(document.products, payloadProduct.id || payloadProduct._id) ||
        (product.productType && relationContains(document.productTypes, product.productType._id))))
    .filter((document) => !document.effectiveDate || new Date(document.effectiveDate).getTime() <= now)
    .filter((document) => !(document.expiryDate || document.expiresAt) ||
      new Date(document.expiryDate || document.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.effectiveDate || 0) - new Date(a.effectiveDate || 0))
    .map((document) => {
      const id = toId(document.id || document._id);
      const gated = document.gating !== 'open';
      const file = document.file && typeof document.file === 'object' ? document.file : null;
      return {
        _id: id,
        title: document.title,
        type: document.type,
        currentVersion: document.currentVersion || document.version,
        fileUrl: gated ? null : `/api/downloads/${id}`,
        fileSizeBytes: file?.filesize ?? null,
        gating: document.gating || 'open',
        downloadCount: document.downloadCount || 0,
        effectiveDate: document.effectiveDate,
      };
    });
  const safeManuals = sanitiseProductManuals(manuals);
  const breadcrumbs = [
    { name: 'Home', url: '/' },
    { name: product.category?.name?.en || 'Products', url: product.category ? `/category/${product.category.slug}` : '/products' },
    { name: product.name?.en || slug, url: null },
  ];
  const reviewFilter = { product: payloadProduct.id || payloadProduct._id, status: 'approved' };
  const [approvedReviews, reviewCount, ratingAgg] = await Promise.all([
    Review.find(reviewFilter)
      .select('rating displayName body createdAt isVerifiedPurchase')
      .limit(10)
      .lean(),
    Review.countDocuments(reviewFilter),
    Review.aggregate([
      { $match: reviewFilter },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
  ]);
  const productJsonLd = buildProductJsonLd(product, rawVariants, product.manufacturer, approvedReviews);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbs);
  const avgRating = ratingAgg.length > 0 ? Number(ratingAgg[0].avg.toFixed(1)) : null;
  let relatedProducts = product.relatedProducts || [];
  if (!relatedProducts.length) {
    const allProducts = await payloadCatalog.getProducts({ depth: 3 });
    relatedProducts = allProducts
      .filter((entry) =>
        entry.slug !== payloadProduct.slug &&
        toId(entry.category) === toId(payloadProduct.category))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
      .slice(0, 4)
      .map(mapProductCard);
  }
  return {
    product,
    variants,
    moduleVisibility,
    content,
    faqs,
    manuals: safeManuals,
    relatedProducts,
    reviews: { summary: { count: reviewCount, averageRating: avgRating }, recent: approvedReviews },
    breadcrumbs,
    jsonLd: { product: productJsonLd, breadcrumb: breadcrumbJsonLd },
  };
};

function sanitiseProductManuals(manuals) {
  return manuals.map((manual) => (
    manual.gating === 'open' ? manual : { ...manual, fileUrl: null }
  ));
}

// ─── Helper: sanitise variant for current user ────────────────────────────────
// Delegates to the single pricing package — priceTiers NEVER sent to client.
const sanitiseVariant = (variant, showPrice, user) => {
  const v = { ...variant, showPrice };
  if (!showPrice) {
    delete v.priceTiers;
    delete v.basePrice;
    return { ...v, displayPrice: null, priceType: 'quote' };
  }
  return pricing.sanitiseVariantForUser(v, user);
};

// ─── Public: get product detail page ─────────────────────────────────────────
const getProduct = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const user     = await resolvePricingUser(req.user || null);

    if (isPayloadEditorialSource()) {
      const data = await getPayloadProduct(slug, user);
      if (!data) {return next(createError(404, 'Product not found.'));}
      return res.json({ success: true, data });
    }

    // ── 1. Load product ──────────────────────────────────────────────────────
    const product = await Product.findOne(publishedReadFilter({ slug, isActive: true }))
      .populate('category',     'name slug')
      .populate('productType',  'name slug code activeModules')
      .populate('manufacturer', 'name slug logo')
      .populate('segments',     'name slug')
      .populate('fabrics',      'name slug brand subRange opennessFactor warrantyYears images sampleAvailable')
      .populate('colors',       'name slug code hexValue swatchImage finish hasSurcharge')
      .populate('relatedProducts', 'name slug images showPrice productType')
      .populate('accessories',     'name slug images basePrice isCrossSell')
      .lean();

    if (!product) {return next(createError(404, 'Product not found.'));}

    // ── 2. Load variants with server-side price visibility ───────────────────
    const rawVariants = await Variant.find(publishedReadFilter({ product: product._id, isActive: true }))
      .populate('allowedOptionGroups')
      .sort('sortOrder')
      .lean();

    // showPrice comes from the parent product
    const variantsWithPrice = rawVariants.map((v) =>
      sanitiseVariant(v, product.showPrice, user)
    );

    // ── 3. Determine module visibility ────────────────────────────────────────
    const moduleVisibility = buildModuleVisibility(
      product.productType ? product.productType.activeModules : []
    );

    // ── 4. Load module content (only the modules that are visible) ────────────
    const content = await ProductContent.findOne({ product: product._id }).lean();

    // ── 5. Load FAQs tagged to this product ───────────────────────────────────
    let faqs = [];
    if (moduleVisibility.faq) {
      faqs = await FAQ.find({
        isActive: true,
        status:   'published',
        $or: [
          { products:     product._id },
          { productTypes: product.productType ? product.productType._id : null },
        ],
      })
        .sort('sortOrder')
        .lean();
    }

    // ── 6. Load documents / manuals ───────────────────────────────────────────
    let manuals = [];
    if (moduleVisibility.manuals) {
      manuals = await Document.find({
        isActive:  true,
        $or: [
          { products:     product._id },
          { productTypes: product.productType ? product.productType._id : null },
        ],
        // Only return non-expired documents
        $and: [
          { $or: [{ effectiveDate: null }, { effectiveDate: { $lte: new Date() } }] },
          { $or: [{ expiryDate: null }, { expiryDate: { $gt: new Date() } }] },
        ],
      })
        .select('title type currentVersion fileUrl fileSizeBytes gating downloadCount effectiveDate')
        .sort('-effectiveDate')
        .lean();
      manuals = sanitiseProductManuals(manuals);
    }

    // ── 7. Build breadcrumbs ──────────────────────────────────────────────────
    const breadcrumbs = [
      { name: 'Home',                url: '/' },
      { name: product.category  ? product.category.name.en  : 'Products', url: product.category  ? `/category/${product.category.slug}`  : '/products' },
      { name: product.name.en,  url: null },
    ];

    // ── 8. JSON-LD structured data ────────────────────────────────────────────
    const approvedReviews = await Review.find({
      product: product._id,
      status:  'approved',
    })
      .select('rating displayName body createdAt isVerifiedPurchase')
      .limit(10)
      .lean();

    const productJsonLd    = buildProductJsonLd(product, rawVariants, product.manufacturer, approvedReviews);
    const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbs);

    // ── 9. Review summary ─────────────────────────────────────────────────────
    const reviewCount  = await Review.countDocuments({ product: product._id, status: 'approved' });
    const ratingAgg    = await Review.aggregate([
      { $match: { product: product._id, status: 'approved' } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const avgRating = ratingAgg.length > 0 ? parseFloat(ratingAgg[0].avg.toFixed(1)) : null;

    // ── 10. Related products (fallback to same category if none curated) ──────
    let relatedProducts = product.relatedProducts || [];
    if (relatedProducts.length === 0) {
      relatedProducts = await Product.find(publishedReadFilter({
        category:  product.category ? product.category._id : null,
        isActive:  true,
        _id:       { $ne: product._id },
      }))
        .select('name slug images showPrice productType')
        .populate('productType', 'name slug')
        .limit(4)
        .lean();
    }

    // ── 11. Assemble response ─────────────────────────────────────────────────
    const productVideos = await Video.find(publishedReadFilter({
      products: product._id,
      status: 'published',
      isActive: true,
    })).sort('sortOrder createdAt').lean();

    res.json({
      success: true,
      data: {
        product: {
          ...product,
          videos: productVideos.map((video) => ({
            _id: String(video._id),
            videoUrl: video.videoUrl,
            title: video.title,
            description: video.description,
            category: video.category,
            thumbnail: video.thumbnail?.url ? video.thumbnail : null,
            chapters: video.chapters || [],
            transcript: video.transcript,
            captionsUrl: video.captionsUrl || '',
            products: [],
          })),
        },
        variants:          variantsWithPrice,
        moduleVisibility,
        content:           content || null,
        faqs,
        manuals,
        relatedProducts,
        reviews: {
          summary: { count: reviewCount, averageRating: avgRating },
          recent:  approvedReviews,
        },
        breadcrumbs,
        jsonLd: {
          product:    productJsonLd,
          breadcrumb: breadcrumbJsonLd,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Public: list products (with optional category/type filter) ───────────────
const listProducts = async (req, res, next) => {
  try {
    const user = await resolvePricingUser(req.user || null);
    const {
      category,
      productType,
      featured,
      page  = 1,
      limit = 24,
      sort  = 'sortOrder',
    } = req.query;

    if (isPayloadEditorialSource()) {
      const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
      const limitNum = Math.min(96, Math.max(1, Number.parseInt(limit, 10) || 24));
      const allProducts = (await payloadCatalog.getProducts({ depth: 3 }))
        .filter((product) => product.isActive !== false)
        .filter((product) => productMatchesPayloadFilters(product, { category, productType, featured: Boolean(featured) }));
      const cmsVariants = await payloadCatalog.getVariantsForProducts(allProducts.map((product) => toId(product.id || product._id)));
      const cards = await addPayloadPrices(allProducts, cmsVariants, user);
      const priceById = new Map(cards.map((card) => [card._id, card.priceFrom]));
      let sorted = [...allProducts];
      if (sort === 'price_asc' || sort === 'price_desc') {
        sorted.sort((a, b) => {
          const left = priceById.get(toId(a.id || a._id)) ?? (sort === 'price_asc' ? Infinity : -Infinity);
          const right = priceById.get(toId(b.id || b._id)) ?? (sort === 'price_asc' ? Infinity : -Infinity);
          return sort === 'price_asc' ? left - right : right - left;
        });
      } else {
        sorted = sortProducts(sorted, sort);
      }
      const total = sorted.length;
      const products = sorted
        .slice((pageNum - 1) * limitNum, pageNum * limitNum)
        .map((product) => cards.find((card) => card._id === toId(product.id || product._id)))
        .filter(Boolean);
      return res.json({
        success: true,
        data: products,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const filter = { isActive: true };
    if (category)    {filter.category    = category;}
    if (productType) {filter.productType = productType;}
    if (featured)    {filter.isFeatured  = true;}

    const SORT_MAP = {
      sortOrder:  { sortOrder: 1 },
      newest:     { createdAt: -1 },
      name_asc:   { 'name.en': 1 },
      popular:    { viewCount: -1 },
    };

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(96, parseInt(limit, 10));

    const [products, total] = await Promise.all([
      Product.find(publishedReadFilter(filter))
        .select('name slug shortDescription images showPrice isFeatured isNewArrival productType category')
        .populate('productType', 'name slug')
        .populate('category',    'name slug')
        .sort(SORT_MAP[sort] || { sortOrder: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(publishedReadFilter(filter)),
    ]);

    // Attach the minimum price visible to this user without exposing tier data.
    const ids      = products.map((p) => p._id);
    const variants = await Variant.find(publishedReadFilter({ product: { $in: ids }, isActive: true }))
      .select('product basePrice priceTiers availability')
      .lean();

    const priceMap = {};
    for (const v of variants) {
      const pid = v.product.toString();
      const displayPrice = pricing.resolvePriceForUser(v.basePrice, v.priceTiers || [], user).displayPrice;
      if (priceMap[pid] === undefined || displayPrice < priceMap[pid]) {priceMap[pid] = displayPrice;}
    }

    const result = products.map((p) => ({
      ...p,
      priceFrom: p.showPrice ? (priceMap[p._id.toString()] ?? null) : null,
    }));

    res.json({
      success: true,
      data: result,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: upsert product content ───────────────────────────────────────────
const adminUpsertContent = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const prod = await Product.findById(productId);
    if (!prod) {return next(createError(404, 'Product not found.'));}

    const content = await ProductContent.findOneAndUpdate(
      { product: productId },
      { $set: { ...req.body, product: productId } },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ success: true, data: content });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: get product content ───────────────────────────────────────────────
const adminGetContent = async (req, res, next) => {
  try {
    const content = await ProductContent.findOne({ product: req.params.productId })
      .populate('product', 'name slug productType')
      .lean();

    res.json({ success: true, data: content || null });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProduct,
  listProducts,
  addPayloadPrices,
  sanitiseProductManuals,
  adminUpsertContent,
  adminGetContent,
};
