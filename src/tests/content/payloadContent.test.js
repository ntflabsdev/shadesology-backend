'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPayloadContentClient } = require('../../services/payloadContent');

describe('Payload read-only content client', () => {
  it('requests only published collection documents and never forwards write methods', async () => {
    let request;
    const client = createPayloadContentClient({
      baseUrl: 'https://cms.example.test/api',
      fetchImpl: async (url, options) => {
        request = { url: new URL(url), options };
        return new Response(JSON.stringify({ docs: [{ _status: 'published' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const response = await client.findPublished('products', {
      locale: 'all',
      depth: 20,
      limit: 500,
      page: 2,
    });

    assert.equal(response.docs[0]._status, 'published');
    assert.equal(request.options.method, 'GET');
    assert.equal(request.url.searchParams.get('where[_status][equals]'), 'published');
    assert.equal(request.url.searchParams.get('draft'), 'false');
    assert.equal(request.url.searchParams.get('depth'), '4');
    assert.equal(request.url.searchParams.get('limit'), '100');
    assert.equal(request.url.searchParams.get('page'), '2');
  });

  it('restricts collection/global names and locale values to explicit allowlists', async () => {
    const client = createPayloadContentClient({
      baseUrl: 'https://cms.example.test/api',
      fetchImpl: async () => new Response('{}'),
    });

    assert.throws(() => client.findPublished('users'), /Unknown Payload content collection/);
    assert.throws(() => client.findPublishedGlobal('users'), /Unknown Payload content global/);
    assert.throws(() => client.findPublished('products', { locale: 'xx' }), /Unsupported content locale/);
  });

  it('encodes trusted filter operators and loads every published page', async () => {
    const requests = [];
    const client = createPayloadContentClient({
      baseUrl: 'https://cms.example.test/api',
      fetchImpl: async (url) => {
        requests.push(new URL(url));
        const page = Number(new URL(url).searchParams.get('page'));
        return new Response(JSON.stringify({
          docs: [{ id: `product-${page}` }],
          totalPages: 2,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const docs = await client.findAllPublished('products', {
      where: { 'slug[equals]': 'example', 'category[in]': 'a,b' },
    });

    assert.deepEqual(docs.map((doc) => doc.id), ['product-1', 'product-2']);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get('where[slug][equals]'), 'example');
    assert.equal(requests[0].searchParams.get('where[category][in]'), 'a,b');
    assert.equal(requests[1].searchParams.get('page'), '2');
    assert.throws(() => client.findPublished('products', { where: { 'slug][equals': 'x' } }), /Invalid Payload collection filter/);
  });
});
