const LegalPage = require('../../models/LegalPage');
const { createError } = require('../../middlewares/errorHandler');
const { isPayloadEditorialSource } = require('../../services/payloadPublicContent');
const { createPayloadCatalog, richText, toId } = require('../../services/payloadCatalog');

const payloadCatalog = createPayloadCatalog();

const mapPayloadPage = (page) => ({
  ...page,
  _id: toId(page.id || page._id),
  content: richText(page.content),
  status: 'published',
  isActive: true,
});

// ─── Public: get a legal page by slug ────────────────────────────────────────
const getBySlug = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const page = (await payloadCatalog.getPublished('legal-pages', {
        depth: 2,
        where: { 'slug[equals]': req.params.slug },
      }))[0];
      if (!page) {
        return next(createError(404, 'Page not found.'));
      }
      return res.json({ success: true, data: mapPayloadPage(page) });
    }

    const page = await LegalPage.findOne({
      slug: req.params.slug,
      isActive: true,
    }).lean();

    if (!page) {return next(createError(404, 'Page not found.'));}
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
};

// ─── Public: get a legal page by key ─────────────────────────────────────────
const getByKey = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      const page = (await payloadCatalog.getPublished('legal-pages', { depth: 2 }))
        .find((record) => record.key === req.params.key);
      if (!page) {
        return next(createError(404, 'Page not found.'));
      }
      return res.json({ success: true, data: mapPayloadPage(page) });
    }

    const page = await LegalPage.findOne({
      key: req.params.key,
      isActive: true,
    }).lean();

    if (!page) {return next(createError(404, 'Page not found.'));}
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
};

// ─── Public: list all active content pages ───────────────────────────────────
const list = async (req, res, next) => {
  try {
    const { pageType } = req.query;
    if (isPayloadEditorialSource()) {
      const pages = (await payloadCatalog.getPublished('legal-pages', { depth: 1 }))
        .filter((page) => page.isActive !== false && (!pageType || page.pageType === pageType))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
        .map((page) => {
          const mapped = mapPayloadPage(page);
          return {
            _id: mapped._id,
            key: mapped.key,
            slug: mapped.slug,
            title: mapped.title,
            pageType: mapped.pageType,
            updatedAt: mapped.updatedAt,
          };
        });
      return res.json({ success: true, data: pages });
    }

    const filter = { isActive: true };
    if (pageType) {filter.pageType = pageType;}

    const pages = await LegalPage.find(filter)
      .select('key slug title pageType updatedAt')
      .sort('sortOrder')
      .lean();

    res.json({ success: true, data: pages });
  } catch (err) {
    next(err);
  }
};

// ─── Admin CRUD ───────────────────────────────────────────────────────────────
const adminList = async (req, res, next) => {
  try {
    const pages = await LegalPage.find().sort('sortOrder').lean();
    res.json({ success: true, data: pages });
  } catch (err) {
    next(err);
  }
};

const adminCreate = async (req, res, next) => {
  try {
    const page = await LegalPage.create(req.body);
    res.status(201).json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
};

const adminUpdate = async (req, res, next) => {
  try {
    const page = await LegalPage.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!page) {return next(createError(404, 'Page not found.'));}
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
};

const adminDelete = async (req, res, next) => {
  try {
    const page = await LegalPage.findByIdAndDelete(req.params.id);
    if (!page) {return next(createError(404, 'Page not found.'));}
    res.json({ success: true, message: 'Page deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getBySlug, getByKey, list, adminList, adminCreate, adminUpdate, adminDelete };
