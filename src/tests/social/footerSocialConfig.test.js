'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const FooterConfig = require('../../models/FooterConfig');

describe('social channel configuration', () => {
  it('limits social channels to ten and validates feed URL schemes', async () => {
    const footer = new FooterConfig({
      socialLinks: Array.from({ length: 11 }, () => ({
        platform: 'instagram',
        url: 'https://instagram.com/shadesology',
      })),
    });
    await assert.rejects(footer.validate(), /maximum of ten social channels/);

    const unsafeFeed = new FooterConfig({
      instagramFeed: [{
        imageUrl: 'javascript:alert(1)',
        imageAlt: 'Product',
        permalink: 'https://instagram.com/p/example',
      }],
    });
    await assert.rejects(unsafeFeed.validate(), /Instagram feed images must use HTTPS/);
  });
});
