'use strict';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const savedSource = process.env.EDITORIAL_CONTENT_SOURCE;
const savedPayloadUrl = process.env.PAYLOAD_REST_URL;
const savedFetch = global.fetch;

const category = {
  id: 'category-1',
  _status: 'published',
  name: 'Awnings',
  slug: 'awnings',
  isActive: true,
  sortOrder: 1,
  productTypes: [{ id: 'type-1', name: 'Retractable Awning', slug: 'retractable-awning', activeModules: [] }],
};

const product = {
  id: 'product-1',
  _status: 'published',
  name: 'Test Awning',
  slug: 'test-awning',
  shortDescription: 'A product & test published in Payload.',
  category,
  productType: category.productTypes[0],
  showPrice: true,
  isActive: true,
  sortOrder: 1,
  attributes: { mount_type: 'wall' },
  images: [{
    url: 'https://cdn.shadesology.com/test-awning.jpg?size=large&format=webp',
    alt: { en: 'Test & awning exterior', es: 'Toldo de prueba' },
    type: 'video_thumbnail',
  }],
  videoUrl: 'https://cdn.shadesology.com/test-awning.mp4?quality=high&format=mp4',
  features: [],
};

let requests = [];

function payloadResponse(url) {
  const { pathname, searchParams } = url;
  if (pathname.endsWith('/products')) {
    const slug = searchParams.get('where[slug][equals]');
    return { docs: slug ? (slug === product.slug ? [product] : []) : [product], totalPages: 1 };
  }
  if (pathname.endsWith('/categories')) {
    const slug = searchParams.get('where[slug][equals]');
    return { docs: slug ? (slug === category.slug ? [category] : []) : [category], totalPages: 1 };
  }
  if (pathname.endsWith('/variants')) {return { docs: [], totalPages: 1 };}
  if (pathname.endsWith('/attribute-definitions')) {
    return {
      docs: [{
        id: 'attribute-1',
        key: 'mount_type',
        label: 'Mount type',
        type: 'select',
        filterable: true,
        productTypes: [{ id: 'type-1' }],
        options: [{ label: 'Wall', value: 'wall' }],
      }],
      totalPages: 1,
    };
  }
  if (pathname.endsWith('/category-content') || pathname.endsWith('/product-content')) {
    return { docs: [], totalPages: 1 };
  }
  if (pathname.endsWith('/faqs')) {
    return {
      docs: [{
        id: 'faq-1',
        question: 'How do awnings work?',
        answer: 'They provide shade.',
        tags: ['general'],
        products: [],
        productTypes: [],
        sortOrder: 1,
      }],
      totalPages: 1,
    };
  }
  if (pathname.endsWith('/documents')) {
    return {
      docs: [{
        id: 'document-1',
        title: 'Care instructions',
        type: 'manual',
        currentVersion: '1',
        gating: 'open',
        isActive: true,
        showInResourceLibrary: true,
        audienceTags: ['consumer'],
        products: [],
        productTypes: [],
      }],
      totalPages: 1,
    };
  }
  if (pathname.endsWith('/legal-pages')) {
    const slug = searchParams.get('where[slug][equals]');
    const page = {
      id: 'legal-1',
      title: 'Privacy',
      slug: 'privacy',
      key: 'privacy',
      pageType: 'privacy',
      content: 'Privacy content.',
      isActive: true,
      sortOrder: 1,
    };
    return { docs: slug ? (slug === page.slug ? [page] : []) : [page], totalPages: 1 };
  }
  if (
    pathname.endsWith('/reviews') ||
    pathname.endsWith('/segment-pages') ||
    pathname.endsWith('/projects') ||
    pathname.endsWith('/videos') ||
    pathname.endsWith('/inspiration-items')
  ) {
    return { docs: [], totalPages: 1 };
  }
  throw new Error(`Unexpected Payload request: ${url}`);
}

async function invoke(handler, req) {
  let response;
  let error;
  await handler(req, {
    json(value) {
      response = value;
      return this;
    },
  }, (err) => {
    error = err;
  });
  if (error) {throw error;}
  return response;
}

async function withEmptyReviews(callback) {
  const Review = require('../../models/Review');
  const originalFind = Review.find;
  const originalCountDocuments = Review.countDocuments;
  const originalAggregate = Review.aggregate;
  Review.find = () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) });
  Review.countDocuments = async () => 0;
  Review.aggregate = async () => [];
  try {
    return await callback();
  } finally {
    Review.find = originalFind;
    Review.countDocuments = originalCountDocuments;
    Review.aggregate = originalAggregate;
  }
}

describe('Payload catalog read paths', () => {
  before(() => {
    process.env.EDITORIAL_CONTENT_SOURCE = 'payload';
    process.env.PAYLOAD_REST_URL = 'https://payload.example.test/api';
    requests = [];
    global.fetch = async (input) => {
      const url = new URL(input);
      requests.push(url);
      return new Response(JSON.stringify(payloadResponse(url)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  after(() => {
    if (savedSource === undefined) {delete process.env.EDITORIAL_CONTENT_SOURCE;}
    else {process.env.EDITORIAL_CONTENT_SOURCE = savedSource;}
    if (savedPayloadUrl === undefined) {delete process.env.PAYLOAD_REST_URL;}
    else {process.env.PAYLOAD_REST_URL = savedPayloadUrl;}
    global.fetch = savedFetch;
  });

  it('serves published product lists and detail from Payload while preserving commerce IDs only when available', async () => {
    const controller = require('../../controllers/catalog/productController');
    requests = [];
    const list = await invoke(controller.listProducts, { query: { limit: '24' } });
    assert.equal(list.data[0].slug, product.slug);
    assert.equal(list.data[0].name.en, product.name);
    assert.equal(list.data[0].priceFrom, null);

    const detail = await withEmptyReviews(() =>
      invoke(controller.getProduct, { params: { slug: product.slug }, query: {} }));
    assert.equal(detail.data.product.slug, product.slug);
    assert.deepEqual(detail.data.variants, []);
    assert(requests.some((url) => url.pathname.endsWith('/product-content')));
    assert(!requests.some((url) => url.pathname.endsWith('/reviews')));
    assert(requests.every((url) => url.searchParams.get('where[_status][equals]') === 'published'));
  });

  it('serves category filters and product grids from Payload', async () => {
    const controller = require('../../controllers/catalog/categoryController');
    requests = [];
    const response = await invoke(controller.getCategoryPage, {
      params: { slug: category.slug },
      query: { mount_type: 'wall', page: '1', limit: '24' },
    });
    assert.equal(response.data.category.slug, category.slug);
    assert.equal(response.data.products.length, 1);
    assert.equal(response.data.products[0].slug, product.slug);
    assert.deepEqual(response.data.activeFilters, { mount_type: 'wall' });
    assert.equal(response.data.facets[0].key, 'mount_type');
    assert(requests.some((url) => url.pathname.endsWith('/attribute-definitions')));
    assert(requests.some((url) => url.pathname.endsWith('/category-content')));
  });

  it('uses Payload for typeahead, search and sitemap product/category URLs', async () => {
    const searchController = require('../../controllers/search/searchController');
    const { buildSitemapData } = require('../../controllers/content/sitemapController');
    requests = [];
    const typeahead = await invoke(searchController.typeahead, { query: { q: 'test' } });
    assert.equal(typeahead.data.products[0].slug, product.slug);
    const search = await invoke(searchController.search, { query: { q: 'awning', type: 'product' } });
    assert.equal(search.data.products[0].slug, product.slug);
    assert.equal(search.engine, 'payload');

    const sitemap = await buildSitemapData();
    assert(sitemap.categories.some((entry) => entry.url === `/category/${category.slug}`));
    const productSitemapEntry = sitemap.products.find((entry) => entry.url === `/products/${product.slug}`);
    assert(productSitemapEntry);
    assert.deepEqual(productSitemapEntry.images, [{
      url: 'https://cdn.shadesology.com/test-awning.jpg?size=large&format=webp',
      title: 'Test & awning exterior',
    }]);
    assert.deepEqual(productSitemapEntry.video, {
      url: product.videoUrl,
      title: product.name,
      description: product.shortDescription,
      thumbnailUrl: 'https://cdn.shadesology.com/test-awning.jpg?size=large&format=webp',
    });
    let xml = '';
    await require('../../controllers/content/sitemapController').xmlSitemap({}, {
      header(name, value) {
        assert.equal(name, 'Content-Type');
        assert.equal(value, 'application/xml');
        return this;
      },
      send(value) {
        xml = value;
      },
    }, (error) => {
      throw error;
    });
    assert(xml.includes('<image:loc>https://cdn.shadesology.com/test-awning.jpg?size=large&amp;format=webp</image:loc>'));
    assert(xml.includes('<video:player_loc>https://cdn.shadesology.com/test-awning.mp4?quality=high&amp;format=mp4</video:player_loc>'));
    assert(xml.includes('<video:description>A product &amp; test published in Payload.</video:description>'));
    assert(requests.some((url) => url.pathname.endsWith('/segment-pages')));
    assert(requests.every((url) => url.searchParams.get('where[_status][equals]') === 'published'));
  });

  it('serves FAQ and document library metadata from Payload without exposing file URLs', async () => {
    const contentRouter = require('../../routes/content');
    const routeHandler = (path) => contentRouter.stack
      .find((layer) => layer.route?.path === path)
      .route.stack[0].handle;
    const faqs = await invoke(routeHandler('/faqs'), { query: { limit: '20' } });
    assert.equal(faqs.data[0].question.en, 'How do awnings work?');

    const documents = await invoke(routeHandler('/documents'), { query: {} });
    assert.equal(documents.data[0]._id, 'document-1');
    assert.equal(documents.data[0].fileUrl, '/api/downloads/document-1');
  });

  it('serves public legal-page reads from published Payload records', async () => {
    const controller = require('../../controllers/content/legalController');
    const page = await invoke(controller.getBySlug, { params: { slug: 'privacy' } });
    assert.equal(page.data._id, 'legal-1');
    assert.equal(page.data.content.en, 'Privacy content.');
    const list = await invoke(controller.list, { query: { pageType: 'privacy' } });
    assert.equal(list.data[0].slug, 'privacy');
  });
});
