'use strict';

const express = require('express');
const { createPayloadContentClient } = require('../services/payloadContent');
const { isPayloadEditorialSource, publishedReadFilter } = require('../services/payloadPublicContent');
const { createError } = require('../middlewares/errorHandler');
const InspirationItem = require('../models/InspirationItem');
const Project = require('../models/Project');
const Video = require('../models/Video');

const router = express.Router();
const publicLimit = 100;

const idOf = (value) => {
  if (value === null || value === undefined) {return '';}
  return String(typeof value === 'object' ? value.id || value._id || '' : value);
};

const richTextValue = (value) => {
  if (!value || typeof value !== 'object') {return '';}
  if (typeof value.text === 'string') {return value.text;}
  const children = value.children || value.root?.children || [];
  return Array.isArray(children) ? children.map(richTextValue).filter(Boolean).join(' ') : '';
};

const localized = (value) => {
  if (value === null || value === undefined) {return { en: '' };}
  if (typeof value === 'string') {return { en: value };}
  if (value.root || value.children) {return { en: richTextValue(value) };}
  const translated = Object.fromEntries(Object.entries(value).map(([locale, text]) => [
    locale,
    typeof text === 'string' ? text : richTextValue(text),
  ]));
  if (Object.values(translated).some(Boolean)) {return translated;}
  return value;
};

const media = (value) => {
  const item = value && typeof value === 'object' ? value : {};
  return {
    url: item.url || '',
    alt: localized(item.alt),
    width: item.width || null,
    height: item.height || null,
  };
};

const isActive = (item) => item.isActive !== false;
const relationList = (values) => (Array.isArray(values) ? values : [])
  .filter((value) => value && typeof value === 'object');

const mapProject = (project) => ({
  _id: idOf(project.id || project._id),
  title: localized(project.title),
  slug: project.slug,
  description: localized(project.description),
  location: project.location || {},
  areaSqFt: project.areaSqFt ?? null,
  installerName: project.installerName || '',
  installerProfileUrl: project.installerProfileUrl || '',
  segments: relationList(project.segment || project.segments).map((segment) => ({
    _id: idOf(segment),
    name: localized(segment.name),
    slug: segment.slug || '',
    audience: segment.audience || '',
  })),
  products: relationList(project.products).map((product) => ({
    _id: idOf(product),
    name: localized(product.name),
    slug: product.slug || '',
    images: (product.images || []).map((entry) => media(entry.image || entry)),
  })),
  gallery: (project.gallery || []).map((entry, index) => ({
    ...media(entry.image || entry),
    alt: localized(entry.alt || entry.image?.alt),
    isBefore: entry.isBefore === true,
    isAfter: entry.isAfter === true,
    sortOrder: entry.sortOrder ?? index,
  })).filter((image) => image.url),
  challenge: localized(project.challenge),
  solution: localized(project.solution),
  budget: localized(project.budget),
  results: localized(project.results),
  energySavings: localized(project.energySavings),
  metrics: (project.metrics || []).map((metric) => ({
    label: localized(metric.label),
    value: metric.value || '',
    unit: metric.unit || '',
  })),
  isFeatured: project.isFeatured === true,
  completedAt: project.completedAt || null,
  updatedAt: project.updatedAt || null,
  metaTitle: localized(project.metaTitle),
  metaDescription: localized(project.metaDescription),
});

const mapInspiration = (item) => ({
  _id: idOf(item.id || item._id),
  title: localized(item.title),
  slug: item.slug,
  image: media(item.image),
  alt: localized(item.alt || item.image?.alt),
  style: item.style || '',
  productType: item.productType && typeof item.productType === 'object'
    ? { name: localized(item.productType.name), slug: item.productType.slug || '' }
    : null,
  setting: item.setting || '',
  color: item.color || '',
  manufacturer: item.manufacturer && typeof item.manufacturer === 'object'
    ? { name: localized(item.manufacturer.name), slug: item.manufacturer.slug || '' }
    : null,
  products: relationList(item.products).map((product) => ({
    _id: idOf(product),
    name: localized(product.name),
    slug: product.slug || '',
  })),
  project: item.project && typeof item.project === 'object'
    ? { title: localized(item.project.title), slug: item.project.slug || '' }
    : null,
});

const mapVideo = (video) => {
  const title = localized(video.title);
  if (!title.en) {
    const hostname = new URL(video.videoUrl).hostname.toLowerCase();
    const host = hostname.includes('youtube') || hostname === 'youtu.be'
      ? 'YouTube'
      : hostname.includes('vimeo')
        ? 'Vimeo'
        : 'Wistia';
    title.en = `${host} video`;
  }
  return {
    _id: idOf(video.id || video._id),
    videoUrl: video.videoUrl,
    title,
    description: localized(video.description),
    category: video.category || 'demo',
    thumbnail: video.thumbnail ? media(video.thumbnail) : null,
    products: relationList(video.products).map((product) => ({
      _id: idOf(product),
      name: localized(product.name),
      slug: product.slug || '',
    })),
    chapters: (video.chapters || []).map((chapter) => ({
      title: chapter.title || '',
      seconds: Number(chapter.seconds) || 0,
    })),
    transcript: localized(video.transcript),
    captionsUrl: video.captionsUrl || '',
    sortOrder: video.sortOrder ?? 0,
    createdAt: video.createdAt || null,
  };
};

async function published(slug) {
  const docs = await createPayloadContentClient().findAllPublished(slug, {
    locale: 'all',
    depth: 3,
    limit: publicLimit,
  });
  return docs.filter(isActive);
}

async function listPublished(slug, Model, populateFields = []) {
  if (isPayloadEditorialSource()) {return published(slug);}

  let query = Model.find(publishedReadFilter({ status: 'published', isActive: true }));
  for (const field of populateFields) {query = query.populate(field);}
  return query.lean();
}

function matchesText(values, query) {
  if (!query) {return true;}
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  return values.some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery));
}

router.get('/inspiration', async (req, res, next) => {
  try {
    const docs = (await listPublished('inspiration-items', InspirationItem, [
      'productType',
      'manufacturer',
      'products',
      'project',
    ])).map(mapInspiration);
    const filtered = docs.filter((item) =>
      matchesText([
        item.title.en,
        item.alt.en,
        item.style,
        item.setting,
        item.color,
        item.productType?.name.en,
        item.manufacturer?.name.en,
      ], req.query.q) &&
      (!req.query.style || item.style === req.query.style) &&
      (!req.query.productType || item.productType?.slug === req.query.productType) &&
      (!req.query.setting || item.setting === req.query.setting) &&
      (!req.query.color || item.color === req.query.color) &&
      (!req.query.manufacturer || item.manufacturer?.slug === req.query.manufacturer)
    );
    filtered.sort((a, b) => a.title.en.localeCompare(b.title.en));
    res.json({ success: true, data: filtered });
  } catch (error) {
    next(error);
  }
});

router.get('/projects', async (req, res, next) => {
  try {
    const docs = (await listPublished('projects', Project, ['segments', 'products'])).map(mapProject);
    if (req.query.audience && !['residential', 'commercial'].includes(req.query.audience)) {
      return next(createError(400, 'audience must be residential or commercial.'));
    }
    const filtered = docs.filter((project) =>
      (!req.query.segment || project.segments.some((segment) => segment.slug === req.query.segment)) &&
      (!req.query.audience || project.segments.some((segment) => segment.audience === req.query.audience)) &&
      matchesText([
        project.title.en,
        project.description.en,
        project.location.city,
        project.location.state,
        project.installerName,
        ...project.segments.map((segment) => segment.name.en),
      ], req.query.q)
    );
    filtered.sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) {return a.isFeatured ? -1 : 1;}
      return new Date(b.completedAt || b.updatedAt || 0) - new Date(a.completedAt || a.updatedAt || 0);
    });
    res.json({ success: true, data: filtered });
  } catch (error) {
    next(error);
  }
});

router.get('/projects/:slug', async (req, res, next) => {
  try {
    const docs = await listPublished('projects', Project, ['segments', 'products']);
    const project = docs.find((entry) => entry.slug === req.params.slug);
    if (!project) {return next(createError(404, 'Project not found.'));}
    res.json({ success: true, data: mapProject(project) });
  } catch (error) {
    next(error);
  }
});

router.get('/videos', async (req, res, next) => {
  try {
    const docs = (await listPublished('videos', Video, ['products'])).map(mapVideo);
    const filtered = docs.filter((video) =>
      (!req.query.category || video.category === req.query.category) &&
      (!req.query.product || video.products.some((product) => product.slug === req.query.product)) &&
      matchesText([video.title.en, video.description.en, video.category, video.transcript.en], req.query.q)
    );
    filtered.sort((a, b) => a.sortOrder - b.sortOrder || a.title.en.localeCompare(b.title.en));
    res.json({ success: true, data: filtered });
  } catch (error) {
    next(error);
  }
});

router.get('/videos/:id', async (req, res, next) => {
  try {
    const videos = await listPublished('videos', Video, ['products']);
    const video = videos.find((entry) => idOf(entry.id || entry._id) === req.params.id);
    if (!video) {return next(createError(404, 'Video not found.'));}
    res.json({ success: true, data: mapVideo(video) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
