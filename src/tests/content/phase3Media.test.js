'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Video = require('../../models/Video');
const InspirationItem = require('../../models/InspirationItem');
const Project = require('../../models/Project');

test('video records need only a supported hosted URL to be published', async () => {
  const video = new Video({ videoUrl: 'https://youtu.be/AbCdEf12345', status: 'published' });
  await video.validate();
  assert.equal(video.category, 'demo');
});

test('video URLs reject insecure, unsupported, and non-video host links', async () => {
  for (const videoUrl of [
    'http://youtu.be/AbCdEf12345',
    'https://example.com/video.mp4',
    'https://youtube.com',
  ]) {
    const video = new Video({ videoUrl });
    await assert.rejects(video.validate(), (error) => {
      assert.match(error.errors.videoUrl.message, /HTTPS YouTube, Vimeo, or Wistia/);
      return true;
    });
  }
});

test('inspiration image records validate localized title and source image URL', async () => {
  const missingImage = new InspirationItem({
    title: { en: 'Terrace shade' },
    slug: 'terrace-shade',
  });
  await assert.rejects(missingImage.validate(), (error) => {
    assert.ok(error.errors['image.url']);
    return true;
  });
});

test('project schema includes case-study savings, metrics, and before/after image fields', () => {
  assert.ok(Project.schema.path('energySavings'));
  assert.ok(Project.schema.path('metrics'));
  assert.ok(Project.schema.path('images').schema.path('isBefore'));
  assert.ok(Project.schema.path('images').schema.path('isAfter'));
});
