'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  editorialSource,
  mapHomepage,
  mapNavigation,
  mapMobileNavigation,
  mapFooter,
  mapSegment,
  mapSegmentPage,
  migrateLegacyHomepage,
  migrateLegacyNavigation,
  migrateLegacyFooter,
} = require('../../services/payloadPublicContent');
const { getSections } = require('../../controllers/homepage/homepageController');
const { getMainNav, getMobileNav } = require('../../controllers/nav/navController');
const { getFooter } = require('../../controllers/footer/footerController');
const { listCategories } = require('../../controllers/catalog/categoryController');
const { listPublished } = require('../../controllers/segments/segmentPageController');

async function invoke(handler, req = {}) {
  let responseBody;
  await handler(req, { json: (body) => { responseBody = body; } }, (error) => {
    if (error) {
      throw error;
    }
  });
  return responseBody;
}

describe('Payload public content adapters', () => {
  it('selects only the configured editorial source', () => {
    const original = process.env.EDITORIAL_CONTENT_SOURCE;
    try {
      delete process.env.EDITORIAL_CONTENT_SOURCE;
      assert.equal(editorialSource(), 'mongoose');
      process.env.EDITORIAL_CONTENT_SOURCE = 'payload';
      assert.equal(editorialSource(), 'payload');
      process.env.EDITORIAL_CONTENT_SOURCE = 'unknown';
      assert.throws(() => editorialSource(), /must be mongoose or payload/);
    } finally {
      if (original === undefined) {
        delete process.env.EDITORIAL_CONTENT_SOURCE;
      } else {
        process.env.EDITORIAL_CONTENT_SOURCE = original;
      }
    }
  });

  it('adds an explicit published-or-legacy predicate for shared Mongoose reads', () => {
    const { publishedReadFilter } = require('../../services/payloadPublicContent');
    const filter = publishedReadFilter({ isActive: true });
    assert.deepEqual(filter.$and[0], { isActive: true });
    assert.deepEqual(filter.$and[1].$or, [
      { _status: 'published' },
      { _status: { $exists: false } },
    ]);
  });

  it('maps ordered, enabled Payload homepage blocks to storefront sections', () => {
    const sections = mapHomepage({
      sections: [
        { id: 'hero-1', blockType: 'hero', enabled: true, headline: { en: 'Shade', es: 'Sombra' } },
        { id: 'disabled', blockType: 'trust-band', enabled: false, items: [] },
        { id: 'text-1', blockType: 'rich-content', enabled: true, body: { en: { root: { children: [] } } } },
      ],
    });

    assert.deepEqual(sections.map((section) => section.type), ['hero', 'trust_band', 'rich_content']);
    assert.equal(sections[0].headline.es, 'Sombra');
    assert.equal(sections[1].isActive, false);
    assert.deepEqual(sections[2].payloadRichText.en, { root: { children: [] } });
    assert.deepEqual(sections.map((section) => section.sortOrder), [0, 1, 2]);
  });

  it('maps desktop and mobile navigation while preserving order and disabled items', () => {
    const payloadNavigation = {
      items: [
        {
          label: 'Products',
          url: '/products',
          enabled: true,
          sortOrder: 2,
          children: [{ heading: 'Awnings', url: '/category/awnings', enabled: true, sortOrder: 1 }],
        },
        { label: 'Hidden', url: '/hidden', enabled: false, sortOrder: 1 },
      ],
      mobileItems: [{ label: 'Shop', url: '/products', enabled: true, sortOrder: 0 }],
    };
    const desktop = mapNavigation(payloadNavigation);
    const mobile = mapMobileNavigation(payloadNavigation);

    assert.deepEqual(desktop.items.map((item) => item.label), [{ en: 'Products' }]);
    assert.equal(desktop.items[0].children[0].heading.en, 'Awnings');
    assert.equal(mobile.items[0].label.en, 'Shop');
  });

  it('maps footer globals into the existing footer contract', () => {
    const footer = mapFooter({
      linkGroups: [{
        id: 'group-1',
        heading: { en: 'Explore' },
        links: [
          { label: 'Products', url: '/products', enabled: true },
          { label: 'Hidden', url: '/hidden', enabled: false },
        ],
      }],
      socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/example', enabled: true }],
      copyright: { en: 'Copyright' },
      newsletterEnabled: true,
    });

    assert.equal(footer.linkGroups[0]._id, 'group-1');
    assert.equal(footer.linkGroups[0].links.length, 1);
    assert.equal(footer.socialLinks[0].isActive, true);
    assert.equal(footer.copyrightText.en, 'Copyright');
  });

  it('maps published segment and segment-page content for existing storefront pages', () => {
    const segment = mapSegment({
      id: 'segment-id',
      name: { en: 'Residential' },
      slug: 'residential',
      audience: 'residential',
      heroImage: { url: 'https://cdn.example/hero.webp', alt: { en: 'Home' } },
    });
    const page = mapSegmentPage({
      id: 'page-id',
      slug: 'residential',
      segment,
      contentBlocks: [{
        blockType: 'text',
        heading: { en: 'Heading' },
        body: { en: { root: { children: [{ children: [{ text: 'Body copy' }] }] } } },
      }],
    });

    assert.equal(page.segment.name.en, 'Residential');
    assert.equal(page.contentBlocks[0].type, 'rich_text');
    assert.equal(page.contentBlocks[0].content.en, 'Body copy');
    assert.equal(page.status, 'published');
  });

  it('serves homepage blocks from the published Payload global when cutover is enabled', async () => {
    const previousSource = process.env.EDITORIAL_CONTENT_SOURCE;
    const previousUrl = process.env.PAYLOAD_REST_URL;
    const previousFetch = global.fetch;
    process.env.EDITORIAL_CONTENT_SOURCE = 'payload';
    process.env.PAYLOAD_REST_URL = 'https://cms.example.test/api';
    let requestedUrl;
    global.fetch = async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify({
        sections: [{ id: 'hero', blockType: 'hero', enabled: true, headline: { en: 'CMS hero' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
      let responseBody;
      await getSections({}, { json: (body) => { responseBody = body; } }, (error) => {
        if (error) {
          throw error;
        }
      });

      it('serves navigation, footer, categories, and segment pages from Payload when cut over', async () => {
        const previousSource = process.env.EDITORIAL_CONTENT_SOURCE;
        const previousUrl = process.env.PAYLOAD_REST_URL;
        const previousFetch = global.fetch;
        process.env.EDITORIAL_CONTENT_SOURCE = 'payload';
        process.env.PAYLOAD_REST_URL = 'https://cms.example.test/api';
        global.fetch = async (url) => {
          const pathname = new URL(url).pathname;
          const data = {
            '/api/globals/navigation': {
              items: [{ label: 'Products', url: '/products', enabled: true }],
              mobileItems: [{ label: 'Shop', url: '/products', enabled: true }],
            },
            '/api/globals/footer': {
              phone: '555-0100',
              linkGroups: [{ heading: 'Explore', links: [] }],
            },
            '/api/categories': {
              docs: [{ id: 'category-1', name: { en: 'Awnings' }, slug: 'awnings', isActive: true }],
            },
            '/api/segment-pages': {
              docs: [{
                id: 'page-1',
                slug: 'residential',
                isActive: true,
                segment: {
                  id: 'segment-1',
                  name: { en: 'Residential' },
                  slug: 'residential',
                  audience: 'residential',
                  isActive: true,
                },
              }],
            },
            '/api/segments': { docs: [] },
          }[pathname];
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        try {
          const [desktopNav, mobileNav, footer, categories, segmentPages] = await Promise.all([
            invoke(getMainNav),
            invoke(getMobileNav),
            invoke(getFooter),
            invoke(listCategories),
            invoke(listPublished, { query: {} }),
          ]);

          assert.equal(desktopNav.data.items[0].label.en, 'Products');
          assert.equal(mobileNav.data.items[0].label.en, 'Shop');
          assert.equal(footer.data.phone, '555-0100');
          assert.equal(categories.data[0].name.en, 'Awnings');
          assert.equal(segmentPages.data[0].slug, 'residential');
          assert.equal(segmentPages.total, 1);
        } finally {
          global.fetch = previousFetch;
          if (previousSource === undefined) {
            delete process.env.EDITORIAL_CONTENT_SOURCE;
          } else {
            process.env.EDITORIAL_CONTENT_SOURCE = previousSource;
          }
          if (previousUrl === undefined) {
            delete process.env.PAYLOAD_REST_URL;
          } else {
            process.env.PAYLOAD_REST_URL = previousUrl;
          }
        }
      });

      it('passes Payload read failures to the route error handler', async () => {
        const previousSource = process.env.EDITORIAL_CONTENT_SOURCE;
        const previousUrl = process.env.PAYLOAD_REST_URL;
        const previousFetch = global.fetch;
        process.env.EDITORIAL_CONTENT_SOURCE = 'payload';
        process.env.PAYLOAD_REST_URL = 'https://cms.example.test/api';
        global.fetch = async () => {
          throw new Error('connection refused');
        };

        try {
          await assert.rejects(() => invoke(getFooter), /Payload content API is unavailable/);
        } finally {
          global.fetch = previousFetch;
          if (previousSource === undefined) {
            delete process.env.EDITORIAL_CONTENT_SOURCE;
          } else {
            process.env.EDITORIAL_CONTENT_SOURCE = previousSource;
          }
          if (previousUrl === undefined) {
            delete process.env.PAYLOAD_REST_URL;
          } else {
            process.env.PAYLOAD_REST_URL = previousUrl;
          }
        }
      });
      assert.equal(requestedUrl.pathname, '/api/globals/homepage');
      assert.equal(requestedUrl.searchParams.get('draft'), 'false');
      assert.equal(requestedUrl.searchParams.get('locale'), 'all');
      assert.equal(responseBody.data[0].headline.en, 'CMS hero');
    } finally {
      global.fetch = previousFetch;
      if (previousSource === undefined) {
        delete process.env.EDITORIAL_CONTENT_SOURCE;
      } else {
        process.env.EDITORIAL_CONTENT_SOURCE = previousSource;
      }
      if (previousUrl === undefined) {
        delete process.env.PAYLOAD_REST_URL;
      } else {
        process.env.PAYLOAD_REST_URL = previousUrl;
      }
    }
  });

  it('prepares legacy globals for an additive Payload import without losing unsupported sections', () => {
    const homepage = migrateLegacyHomepage([
      {
        _id: 'hero-id',
        type: 'hero',
        isActive: true,
        headline: { en: 'Legacy headline' },
        backgroundImage: { url: 'https://cdn.example/legacy.webp', mobileUrl: '' },
      },
      { _id: 'html-id', type: 'custom_html' },
    ]);
    const navigation = migrateLegacyNavigation({
      items: [{ label: { en: 'Products' }, children: [{ heading: { en: 'Awnings' }, category: 'category-id' }] }],
    }, null);
    const footer = migrateLegacyFooter({
      phone: '555-0100',
      linkGroups: [{ heading: { en: 'Explore' }, links: [{ label: { en: 'Shop' }, url: '/products' }] }],
    });

    assert.equal(homepage.data.sections[0].legacyImageUrl, 'https://cdn.example/legacy.webp');
    assert.deepEqual(homepage.unsupported, [{ id: 'html-id', type: 'custom_html' }]);
    assert.equal(navigation.items[0].children[0].category, 'category-id');
    assert.equal(footer.phone, '555-0100');
    assert.equal(footer.linkGroups[0].links[0].url, '/products');
  });
});
