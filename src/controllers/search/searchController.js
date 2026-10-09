'use strict';

/**
 * Site-wide search controller.
 *
 * Strategy:
 *   1. Try MongoDB Atlas Search ($search with index "site_search") for full-text,
 *      fuzzy matching, relevance scoring.
 *   2. Fall back to $regex across key fields if Atlas Search is not available
 *      (local dev, Atlas free tier without search index configured).
 *
 * Result types:
 *   product  — matched products (name, description, features)
 *   category — matched categories (name, description)
 *   content  — matched legal/content pages and FAQs
 *
 * Typeahead  — fast lightweight suggestions (products + categories, name only)
 * Full search — paginated multi-type results with snippets
 */

const Product  = require('../../models/Product');
const Category = require('../../models/Category');
const LegalPage= require('../../models/LegalPage');
const FAQ      = require('../../models/FAQ');
const { createError } = require('../../middlewares/errorHandler');
const { isPayloadEditorialSource } = require('../../services/payloadPublicContent');
const {
  createPayloadCatalog,
  mapProductCard,
  mapCategory,
  matchesText,
  richText,
} = require('../../services/payloadCatalog');

const ATLAS_SEARCH_INDEX = 'site_search';
const payloadCatalog = createPayloadCatalog();

const payloadTypeahead = async (query) => {
  const [products, categories] = await Promise.all([
    payloadCatalog.getProducts({ depth: 2 }),
    payloadCatalog.getCategories({ depth: 2 }),
  ]);
  return {
    products: products
      .filter((product) => product.isActive !== false && matchesText(product.name, query))
      .slice(0, 5)
      .map(mapProductCard),
    categories: categories
      .filter((category) => category.isActive !== false && matchesText(category.name, query))
      .slice(0, 3)
      .map(mapCategory),
  };
};

const payloadSearch = async (query, type, page, limit) => {
  const [allProducts, allCategories, legalPages, faqs] = await Promise.all([
    !type || type === 'product' ? payloadCatalog.getProducts({ depth: 2 }) : [],
    !type || type === 'category' ? payloadCatalog.getCategories({ depth: 2 }) : [],
    !type || type === 'content' ? payloadCatalog.getPublished('legal-pages') : [],
    !type || type === 'content' ? payloadCatalog.getPublished('faqs') : [],
  ]);
  const matchedProducts = allProducts
    .filter((product) => product.isActive !== false && matchesText([
      product.name,
      product.shortDescription,
      product.description,
      product.features,
    ], query));
  const matchedCategories = allCategories
    .filter((category) => category.isActive !== false && matchesText([category.name, category.description], query));
  const matchedContent = [
    ...legalPages.filter((pageRecord) => matchesText([pageRecord.title, pageRecord.content], query))
      .map((pageRecord) => ({ type: 'page', title: pageRecord.title, url: `/${pageRecord.slug}`, snippet: '' })),
    ...faqs.filter((faq) => matchesText([faq.question, faq.answer], query))
      .map((faq) => ({
        type: 'faq',
        title: faq.question,
        url: `/support/faq#${faq.id || faq._id}`,
        snippet: richText(faq.answer)?.en?.slice(0, 120) || '',
      })),
  ];
  const productResults = type ? matchedProducts.slice((page - 1) * limit, page * limit) : matchedProducts.slice(0, 6);
  const categoryResults = type ? matchedCategories.slice(0, limit) : matchedCategories.slice(0, 4);
  const contentResults = matchedContent.slice(0, type ? limit : 6);
  const products = productResults.map(mapProductCard);
  const categories = categoryResults.map(mapCategory);
  const content = contentResults;
  const totalProducts = matchedProducts.length;
  const total = (type === 'product' ? totalProducts : products.length) +
    (type === 'category' ? matchedCategories.length : categories.length) +
    (type === 'content' ? matchedContent.length : content.length);
  return {
    success: true,
    query,
    data: { products, categories, content },
    totals: {
      products: totalProducts,
      categories: type === 'category' ? matchedCategories.length : categories.length,
      content: type === 'content' ? matchedContent.length : content.length,
      all: total,
    },
    pagination: type ? { page, limit, total, pages: Math.ceil(total / limit) } : null,
    engine: 'payload',
  };
};

// ─── Atlas Search availability cache ─────────────────────────────────────────
// We do a one-time probe at first use so we don't retry a failing $search on
// every request when Atlas Search is not configured.
let _atlasAvailable = null; // null = untested, true/false = known

async function probeAtlasSearch() {
  if (_atlasAvailable !== null) {return _atlasAvailable;}
  try {
    // Try a minimal $search aggregate — if it throws 'index not found' we know
    await Product.aggregate([
      { $search: { index: ATLAS_SEARCH_INDEX, text: { query: 'probe', path: { wildcard: '*' } } } },
      { $limit: 1 },
    ]);
    _atlasAvailable = true;
  } catch {
    _atlasAvailable = false;
  }
  return _atlasAvailable;
}

// ─── Typeahead (fast, lightweight) ───────────────────────────────────────────
const typeahead = async (req, res, next) => {
  try {
    const { q = '' } = req.query;
    const query = q.trim();
    if (query.length < 2) {
      return res.json({ success: true, data: { products: [], categories: [] } });
    }

    if (isPayloadEditorialSource()) {
      const data = await payloadTypeahead(query);
      return res.json({ success: true, data });
    }

    const atlasOk = await probeAtlasSearch();
    const limit   = 5;

    let products   = [];
    let categories = [];

    if (atlasOk) {
      // ── Atlas Search typeahead ───────────────────────────────────────────
      const [pRes, cRes] = await Promise.all([
        Product.aggregate([
          {
            $search: {
              index: ATLAS_SEARCH_INDEX,
              autocomplete: { query, path: 'name.en', fuzzy: { maxEdits: 1 } },
            },
          },
          { $match: { isActive: true } },
          { $limit: limit },
          { $project: { name: 1, slug: 1, images: { $slice: ['$images', 1] } } },
        ]),
        Category.aggregate([
          {
            $search: {
              index: ATLAS_SEARCH_INDEX,
              autocomplete: { query, path: 'name.en', fuzzy: { maxEdits: 1 } },
            },
          },
          { $match: { isActive: true } },
          { $limit: 3 },
          { $project: { name: 1, slug: 1, image: 1 } },
        ]),
      ]);
      products   = pRes;
      categories = cRes;
    } else {
      // ── $regex fallback ─────────────────────────────────────────────────
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      [products, categories] = await Promise.all([
        Product.find({ 'name.en': regex, isActive: true })
          .select('name slug images')
          .limit(limit)
          .lean(),
        Category.find({ 'name.en': regex, isActive: true })
          .select('name slug image')
          .limit(3)
          .lean(),
      ]);
    }

    res.json({ success: true, data: { products, categories } });
  } catch (err) {
    next(err);
  }
};

// ─── Full search ──────────────────────────────────────────────────────────────
const search = async (req, res, next) => {
  try {
    const {
      q      = '',
      type,         // 'product' | 'category' | 'content' — filter by type
      page   = 1,
      limit  = 12,
    } = req.query;

    const query    = q.trim();
    const pageNum  = Math.max(1, parseInt(page,  10));
    const limitNum = Math.min(50, parseInt(limit, 10));
    const skip     = (pageNum - 1) * limitNum;

    if (!query) {return next(createError(400, 'Search query (q) is required.'));}

    if (isPayloadEditorialSource()) {
      const data = await payloadSearch(query, type, pageNum, limitNum);
      return res.json(data);
    }

    const atlasOk = await probeAtlasSearch();

    let products     = [];
    let productTotal = 0;
    let categories   = [];
    let content      = [];

    if (atlasOk) {
      // ── Atlas Search full search ─────────────────────────────────────────
      const shouldProducts  = !type || type === 'product';
      const shouldCategories= !type || type === 'category';
      const shouldContent   = !type || type === 'content';

      const [pRes, cRes, lRes, fRes] = await Promise.all([
        shouldProducts
          ? Product.aggregate([
              {
                $search: {
                  index: ATLAS_SEARCH_INDEX,
                  text: {
                    query,
                    path: ['name.en', 'shortDescription.en', 'description.en', 'features.text.en'],
                    fuzzy: { maxEdits: 1 },
                  },
                },
              },
              { $match: { isActive: true } },
              {
                $facet: {
                  docs: [
                    { $skip: shouldProducts && type ? skip : 0 },
                    { $limit: type ? limitNum : 6 },
                    { $project: { name: 1, slug: 1, shortDescription: 1, images: { $slice: ['$images', 1] }, score: { $meta: 'searchScore' } } },
                  ],
                  total: [{ $count: 'count' }],
                },
              },
            ])
          : [null],

        shouldCategories
          ? Category.aggregate([
              {
                $search: {
                  index: ATLAS_SEARCH_INDEX,
                  text: {
                    query,
                    path: ['name.en', 'description.en'],
                    fuzzy: { maxEdits: 1 },
                  },
                },
              },
              { $match: { isActive: true } },
              { $limit: type ? limitNum : 4 },
              { $project: { name: 1, slug: 1, image: 1, description: 1 } },
            ])
          : Promise.resolve([]),

        shouldContent
          ? LegalPage.aggregate([
              {
                $search: {
                  index: ATLAS_SEARCH_INDEX,
                  text: { query, path: ['title.en', 'content.en'], fuzzy: { maxEdits: 1 } },
                },
              },
              { $match: { isActive: true } },
              { $limit: 3 },
              { $project: { title: 1, slug: 1, pageType: 1 } },
            ])
          : Promise.resolve([]),

        shouldContent
          ? FAQ.aggregate([
              {
                $search: {
                  index: ATLAS_SEARCH_INDEX,
                  text: { query, path: ['question.en', 'answer.en'], fuzzy: { maxEdits: 1 } },
                },
              },
              { $match: { status: 'published' } },
              { $limit: 3 },
              { $project: { question: 1, answer: 1 } },
            ])
          : Promise.resolve([]),
      ]);

      if (pRes && pRes[0]) {
        products     = pRes[0].docs ?? [];
        productTotal = pRes[0].total?.[0]?.count ?? 0;
      }
      categories = cRes ?? [];

      content = [
        ...(lRes ?? []).map((p) => ({
          type: 'page', title: p.title, url: `/${p.slug}`, snippet: '',
        })),
        ...(fRes ?? []).map((f) => ({
          type: 'faq', title: f.question, url: `/support/faq#${f._id}`,
          snippet: f.answer?.en ? f.answer.en.slice(0, 120) + '…' : '',
        })),
      ];

    } else {
      // ── $regex fallback ─────────────────────────────────────────────────
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      if (!type || type === 'product') {
        const productFilter = {
          isActive: true,
          $or: [
            { 'name.en': regex },
            { 'shortDescription.en': regex },
            { 'description.en': regex },
            { 'features.text.en': regex },
          ],
        };
        [products, productTotal] = await Promise.all([
          Product.find(productFilter)
            .select('name slug shortDescription images productType category')
            .populate('productType', 'name')
            .populate('category', 'name slug')
            .skip(type ? skip : 0)
            .limit(type ? limitNum : 6)
            .lean(),
          Product.countDocuments(productFilter),
        ]);
      }

      if (!type || type === 'category') {
        categories = await Category.find({
          isActive: true,
          $or: [{ 'name.en': regex }, { 'description.en': regex }],
        })
          .select('name slug image description')
          .limit(type ? limitNum : 4)
          .lean();
      }

      if (!type || type === 'content') {
        const [legalPages, faqs] = await Promise.all([
          LegalPage.find({
            isActive: true,
            $or: [{ 'title.en': regex }, { 'content.en': regex }],
          })
            .select('title slug pageType')
            .limit(3)
            .lean(),
          FAQ.find({
            status: 'published',
            $or: [{ 'question.en': regex }, { 'answer.en': regex }],
          })
            .select('question answer')
            .limit(3)
            .lean(),
        ]);

        content = [
          ...legalPages.map((p) => ({
            type: 'page', title: p.title, url: `/${p.slug}`, snippet: '',
          })),
          ...faqs.map((f) => ({
            type: 'faq', title: f.question, url: `/support/faq#${f._id}`,
            snippet: f.answer?.en ? f.answer.en.slice(0, 120) + '…' : '',
          })),
        ];
      }
    }

    const total = productTotal + categories.length + content.length;

    res.json({
      success: true,
      query,
      data: { products, categories, content },
      totals: {
        products: productTotal,
        categories: categories.length,
        content: content.length,
        all: total,
      },
      pagination: type
        ? { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
        : null,
      engine: atlasOk ? 'atlas' : 'regex',
    });
  } catch (err) {
    next(err);
  }
};

// ─── 404 route suggestions ────────────────────────────────────────────────────
const notFoundSuggestions = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const categories = (await payloadCatalog.getCategories({ depth: 2 }))
        .filter((category) => category.isActive !== false)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
        .slice(0, 9)
        .map(mapCategory);
      return res.json({ success: true, data: { categories, searchPrompt: true } });
    }

    const categories = await Category.find({ isActive: true })
      .select('name slug image')
      .sort('sortOrder')
      .limit(9)
      .lean();

    res.json({ success: true, data: { categories, searchPrompt: true } });
  } catch (err) {
    next(err);
  }
};

module.exports = { typeahead, search, notFoundSuggestions };
