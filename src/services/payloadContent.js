const { createError } = require('../middlewares/errorHandler');

const COLLECTIONS = new Set([
  'accessories',
  'attribute-definitions',
  'categories',
  'category-content',
  'colors',
  'documents',
  'faqs',
  'fabrics',
  'inspiration-items',
  'lead-routing-rules',
  'legal-pages',
  'manufacturers',
  'media',
  'option-groups',
  'products',
  'product-content',
  'projects',
  'redirects',
  'reviews',
  'segment-pages',
  'segments',
  'variants',
  'product-types',
  'videos',
]);
const GLOBALS = new Set(['homepage', 'navigation', 'footer']);
const LOCALES = new Set(['all', 'en', 'es', 'de', 'fr', 'it', 'pt']);

function createPayloadContentClient({
  baseUrl = process.env.PAYLOAD_REST_URL,
  fetchImpl = global.fetch,
} = {}) {
  if (!baseUrl) {
    throw createError(503, 'Payload content API is not configured.');
  }
  if (typeof fetchImpl !== 'function') {
    throw createError(500, 'Fetch is unavailable for the Payload content API.');
  }

  const base = `${baseUrl.replace(/\/+$/, '')}/`;

  async function get(path, query) {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
    } catch (error) {
      const unavailable = createError(503, 'Payload content API is unavailable.');
      unavailable.cause = error;
      throw unavailable;
    }

    if (!response.ok) {
      throw createError(502, `Payload content API returned status ${response.status}.`);
    }
    return response.json();
  }

  const findPublished = (slug, { locale = 'all', depth = 2, limit = 50, page = 1, where = {} } = {}) => {
      if (!COLLECTIONS.has(slug)) {
        throw createError(404, 'Unknown Payload content collection.');
      }
      if (!LOCALES.has(locale)) {
        throw createError(400, 'Unsupported content locale.');
      }
      const query = {
        'where[_status][equals]': 'published',
        locale,
        'fallback-locale': 'en',
        draft: false,
        depth: Math.min(4, Math.max(0, Number(depth) || 0)),
        limit: Math.min(100, Math.max(1, Number(limit) || 50)),
        page: Math.max(1, Number(page) || 1),
      };
      for (const [field, value] of Object.entries(where)) {
        if (!/^[a-zA-Z0-9_-]+(?:\[[a-zA-Z0-9_-]+\])*$/.test(field)) {
          throw createError(400, 'Invalid Payload collection filter.');
        }
        const path = field.split('[').join(']').split(']').filter(Boolean).join('][');
        query[`where[${path}]`] = value;
      }
      return get(slug, query);
  };
  const findAllPublished = async (slug, { limit = 100, ...options } = {}) => {
      const pageLimit = Math.min(100, Math.max(1, Number(limit) || 100));
      const firstPage = await findPublished(slug, { ...options, limit: pageLimit, page: 1 });
      const docs = [...(firstPage.docs || [])];
      const totalPages = Number(firstPage.totalPages) || 1;
      for (let page = 2; page <= totalPages; page += 1) {
        const result = await findPublished(slug, { ...options, limit: pageLimit, page });
        docs.push(...(result.docs || []));
      }
      return docs;
  };

  return {
    findPublished,
    findAllPublished,
    findPublishedGlobal: (slug, { locale = 'all', depth = 2 } = {}) => {
      if (!GLOBALS.has(slug)) {
        throw createError(404, 'Unknown Payload content global.');
      }
      if (!LOCALES.has(locale)) {
        throw createError(400, 'Unsupported content locale.');
      }
      return get(`globals/${slug}`, {
        locale,
        'fallback-locale': 'en',
        draft: false,
        depth: Math.min(4, Math.max(0, Number(depth) || 0)),
      });
    },
  };
}

module.exports = { createPayloadContentClient, COLLECTIONS, GLOBALS };
