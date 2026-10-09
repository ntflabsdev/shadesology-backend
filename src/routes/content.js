const express = require('express');
const { getBySlug, getByKey, list } = require('../controllers/content/legalController');
const { htmlSitemap, xmlSitemap }   = require('../controllers/content/sitemapController');
const { subscribe, confirm, unsubscribe } = require('../controllers/content/newsletterController');
const {
  submitLead, getChatStatus, getServiceUploadUrl, getCommercialUploadUrl, registerWarranty,
} = require('../controllers/content/leadController');
const FAQ  = require('../models/FAQ');
const Document = require('../models/Document');
const Product = require('../models/Product');
const ProductType = require('../models/ProductType');
const rateLimit = require('../middlewares/rateLimit');
const { createError } = require('../middlewares/errorHandler');
const { isPayloadEditorialSource } = require('../services/payloadPublicContent');
const { createPayloadCatalog, mapProductCard, matchesText, richText, toId } = require('../services/payloadCatalog');

const router = express.Router();
const payloadCatalog = createPayloadCatalog();

// ─── Legal / content pages ────────────────────────────────────────────────────
router.get('/pages',          list);
router.get('/pages/key/:key', getByKey);
router.get('/pages/:slug',    getBySlug);

// ─── Contact form ─────────────────────────────────────────────────────────────
router.post(
  '/contact',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:contact' }),
  submitLead
);
router.post(
  '/leads',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:leads' }),
  submitLead
);
router.post(
  '/commercial/enquiries',
  rateLimit({ windowMs: 60_000, max: 8, keyPrefix: 'rl:commercial-enquiries' }),
  (req, res, next) => {
    if (typeof req.body?.website === 'string' && req.body.website.trim()) {
      return res.status(202).json({ success: true, message: 'Thank you. Your project enquiry has been received.' });
    }
    req.body = { ...(req.body || {}), type: 'commercial_project' };
    next();
  },
  submitLead
);
router.post(
  '/commercial/upload-url',
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:commercial-upload' }),
  getCommercialUploadUrl
);
router.post(
  '/service-upload-url',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:service-upload' }),
  getServiceUploadUrl
);
router.post(
  '/warranty/register',
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'rl:warranty-register' }),
  registerWarranty
);
router.get('/chat/status', getChatStatus);

// ─── FAQs (public — for resource library and support pages) ───────────────────
router.get('/faqs', async (req, res, next) => {
  try {
    const { tag, productType, limit = 50, q } = req.query;
    const filter = { status: 'published', isActive: true };
    if (typeof tag === 'string' && tag) {filter.tags = tag;}
    if (!isPayloadEditorialSource() && typeof productType === 'string' && productType.trim()) {
      const typeModel = await ProductType.findOne({ slug: productType.trim(), isActive: true }).select('_id').lean();
      if (!typeModel) {return res.json({ success: true, data: [] });}
      filter.productTypes = typeModel._id;
    }
    if (typeof q === 'string' && q.trim()) {
      const safeQuery = q.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { 'question.en': { $regex: safeQuery, $options: 'i' } },
        { 'answer.en': { $regex: safeQuery, $options: 'i' } },
      ];
    }
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return next(createError(400, 'limit must be between 1 and 100.'));
    }

    if (isPayloadEditorialSource()) {
      const [faqs, productTypes] = await Promise.all([
        payloadCatalog.getPublished('faqs'),
        typeof productType === 'string' && productType.trim()
          ? payloadCatalog.getPublished('product-types')
          : Promise.resolve([]),
      ]);
      const requestedType = typeof productType === 'string' && productType.trim()
        ? productTypes.find((entry) => entry.slug === productType.trim())
        : null;
      const query = typeof q === 'string' ? q.trim().slice(0, 100) : '';
      const results = faqs
        .filter((faq) => (!tag || (faq.tags || []).includes(tag)))
        .filter((faq) => !productType || (requestedType && (faq.productTypes || []).some((entry) => toId(entry) === toId(requestedType))))
        .filter((faq) => !query || matchesText([faq.question, faq.answer], query))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
        .slice(0, parsedLimit)
        .map((faq) => ({
          ...faq,
          _id: toId(faq.id || faq._id),
          question: richText(faq.question),
          answer: richText(faq.answer),
        }));
      return res.json({ success: true, data: results });
    }

    const faqs = await FAQ.find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .limit(parsedLimit)
      .select('question answer tags includeInSchema')
      .lean();

    res.json({ success: true, data: faqs });
  } catch (err) {
    next(err);
  }
});

// ─── Documents (public — for resource library) ────────────────────────────────
router.get('/documents', async (req, res, next) => {
  try {
    const { type, productType, product } = req.query;
    const now = new Date();

    // Never serve expired documents
    const filter = {
      isActive: true,
      showInResourceLibrary: true,
      audienceTags: { $nin: ['installer', 'dealer', 'specifier'] },
      requiredRole: { $nin: ['dealer', 'specifier'] },
      $and: [
        { $or: [{ effectiveDate: null }, { effectiveDate: { $lte: now } }] },
        { $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }] },
      ],
    };
    if (typeof type === 'string' && type) {filter.type = type;}
    if (typeof productType === 'string' && productType) {filter.productTypes = productType;}
    if (!isPayloadEditorialSource() && typeof product === 'string' && product.trim()) {
      const model = await Product.findOne({ slug: product.trim(), isActive: true }).select('_id').lean();
      if (!model) {return res.json({ success: true, data: [] });}
      filter.products = model._id;
    }

    if (isPayloadEditorialSource()) {
      const [documents, products, productTypes] = await Promise.all([
        payloadCatalog.getPublished('documents', { depth: 4 }),
        typeof product === 'string' && product.trim()
          ? payloadCatalog.getProducts({ depth: 2 })
          : Promise.resolve([]),
        typeof productType === 'string' && productType
          ? payloadCatalog.getPublished('product-types', { depth: 2 })
          : Promise.resolve([]),
      ]);
      const requestedProduct = typeof product === 'string' && product.trim()
        ? products.find((entry) => entry.slug === product.trim())
        : null;
      const requestedType = typeof productType === 'string' && productType
        ? productTypes.find((entry) => entry.slug === productType || toId(entry) === productType)
        : null;
      if ((product && !requestedProduct) || (productType && !requestedType)) {
        return res.json({ success: true, data: [] });
      }
      const publicDocs = documents
        .filter((doc) => doc.isActive !== false && doc.showInResourceLibrary !== false)
        .filter((doc) => !(doc.audienceTags || []).some((tag) => ['installer', 'dealer', 'specifier'].includes(tag)))
        .filter((doc) => !['dealer', 'specifier'].includes(doc.requiredRole))
        .filter((doc) => !type || doc.type === type)
        .filter((doc) => !requestedProduct || (doc.products || []).some((entry) => toId(entry) === toId(requestedProduct)))
        .filter((doc) => !requestedType || (doc.productTypes || []).some((entry) => toId(entry) === toId(requestedType)))
        .filter((doc) => !doc.effectiveDate || new Date(doc.effectiveDate) <= now)
        .filter((doc) => !(doc.expiryDate || doc.expiresAt) || new Date(doc.expiryDate || doc.expiresAt) > now)
        .sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.title?.en || '').localeCompare(String(b.title?.en || '')))
        .map((doc) => {
          const id = toId(doc.id || doc._id);
          const gated = doc.gating !== 'open';
          const file = doc.file && typeof doc.file === 'object' ? doc.file : null;
          return {
            ...doc,
            _id: id,
            title: doc.title,
            description: richText(doc.description),
            currentVersion: doc.currentVersion || doc.version,
            fileUrl: gated ? null : `/api/downloads/${id}`,
            fileSizeBytes: file?.filesize ?? null,
            expiryDate: doc.expiryDate || doc.expiresAt || null,
            products: (doc.products || []).filter((entry) => entry && typeof entry === 'object').map(mapProductCard),
            productTypes: (doc.productTypes || [])
              .filter((entry) => entry && typeof entry === 'object')
              .map((entry) => ({ ...entry, _id: toId(entry.id || entry._id) })),
            versions: (doc.versions || []).map(({ version, uploadedAt, notes }) => ({ version, uploadedAt, notes })),
          };
        });
      return res.json({ success: true, data: publicDocs });
    }

    const docs = await Document.find(filter)
      .populate('products', 'name slug')
      .populate('productTypes', 'name slug')
      .sort({ type: 1, title: 1 })
      .select('title description type currentVersion versions effectiveDate expiryDate gating requiredRole fileUrl fileSizeBytes mimeType downloadCount products productTypes')
      .lean();

    const publicDocs = docs.map((doc) => {
      if (doc.gating !== 'open') {
        doc.fileUrl = null;
        doc.versions = (doc.versions || []).map(({ version, uploadedAt, notes }) => ({ version, uploadedAt, notes }));
      }
      return doc;
    });
    res.json({ success: true, data: publicDocs });
  } catch (err) {
    next(err);
  }
});

// ─── Sitemap ──────────────────────────────────────────────────────────────────
router.get('/sitemap',     htmlSitemap);
router.get('/sitemap.xml', xmlSitemap);

// ─── Newsletter ───────────────────────────────────────────────────────────────
router.post(
  '/newsletter/subscribe',
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'rl:newsletter' }),
  subscribe
);
router.get('/newsletter/confirm/:token', confirm);
router.post('/newsletter/unsubscribe',   unsubscribe);

module.exports = router;
