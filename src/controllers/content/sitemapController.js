const Product  = require('../../models/Product');
const Category = require('../../models/Category');
const SegmentPage = require('../../models/SegmentPage');
const LegalPage   = require('../../models/LegalPage');
const Project = require('../../models/Project');
const Video = require('../../models/Video');
const InspirationItem = require('../../models/InspirationItem');
const { isPayloadEditorialSource, publishedReadFilter } = require('../../services/payloadPublicContent');
const { createPayloadCatalog, mapCategory, mapProductCard, localize } = require('../../services/payloadCatalog');

const BASE_URL = process.env.FRONTEND_URL || 'https://shadesology.com';
const TRANSLATION_LOCALES = ['es', 'de', 'it', 'fr', 'pt'];
const LOCALE_TAGS = { es: 'es-ES', de: 'de-DE', it: 'it-IT', fr: 'fr-FR', pt: 'pt-PT' };
const payloadCatalog = createPayloadCatalog();

const translatedLocales = (...fields) => TRANSLATION_LOCALES.filter((locale) =>
  fields.some((field) => typeof field?.[locale] === 'string' && field[locale].trim())
);

/**
 * generateSitemap — returns an HTML sitemap page (structured links).
 * Also returns XML data for the frontend to render an XML sitemap.
 *
 * Two endpoints:
 *   GET /sitemap        → HTML structure (JSON for frontend to render)
 *   GET /sitemap.xml    → raw XML string (served directly for crawlers)
 */

// ─── Build sitemap data ───────────────────────────────────────────────────────
const buildSitemapData = async () => {
  if (isPayloadEditorialSource()) {
    const [payloadCategories, payloadProducts, payloadSegmentPages, payloadLegalPages, payloadProjects, payloadVideos, payloadInspiration] = await Promise.all([
      payloadCatalog.getCategories({ depth: 2 }),
      payloadCatalog.getProducts({ depth: 2 }),
      payloadCatalog.getPublished('segment-pages', { depth: 3 }),
      payloadCatalog.getPublished('legal-pages', { depth: 2 }),
      payloadCatalog.getPublished('projects', { depth: 3 }),
      payloadCatalog.getPublished('videos', { depth: 2 }),
      payloadCatalog.getPublished('inspiration-items', { depth: 2 }),
    ]);
    const categories = payloadCategories.filter((category) => category.isActive !== false).map(mapCategory);
    const products = payloadProducts.filter((product) => product.isActive !== false).map(mapProductCard);
    const segmentPages = payloadSegmentPages.filter((page) => page.isActive !== false);
    const legalPages = payloadLegalPages.filter((page) => page.isActive !== false && page.noindex !== true);
    const projects = payloadProjects.filter((project) => project.isActive !== false);
    const videos = payloadVideos.filter((video) => video.isActive !== false);
    const inspirationImages = payloadInspiration
      .filter((item) => item.isActive !== false && item.image?.url)
      .map((item) => ({ url: item.image.url, title: localize(item.alt || item.image.alt)?.en || localize(item.title)?.en || item.slug }));
    return {
      static: [
        { url: '/', label: 'Home', priority: 1.0 },
        { url: '/inspiration', label: 'Inspiration', priority: 0.8, images: inspirationImages },
        { url: '/projects', label: 'Project Gallery', priority: 0.8 },
        { url: '/videos', label: 'Video Library', priority: 0.7 },
        { url: '/quote', label: 'Request a Quote', priority: 0.9 },
        { url: '/find-installer', label: 'Find an Installer', priority: 0.8 },
        { url: '/contact', label: 'Contact Us', priority: 0.8 },
        { url: '/about', label: 'About', priority: 0.7 },
        { url: '/blog', label: 'Blog', priority: 0.7 },
        { url: '/support', label: 'Support Center', priority: 0.7 },
      ],
      categories: categories.map((category) => ({
        url: `/category/${category.slug}`,
        label: category.name?.en || category.slug,
        translations: translatedLocales(category.name, category.metaTitle, category.metaDescription),
        updated: category.updatedAt,
        priority: 0.8,
      })),
      products: products.map((product) => ({
        url: `/products/${product.slug}`,
        label: product.name?.en || product.slug,
        translations: translatedLocales(product.name, product.metaTitle, product.metaDescription),
        updated: product.updatedAt,
        images: product.images
          .filter((image) => image.url)
          .map((image) => ({ url: image.url, title: image.alt?.en || product.name?.en || product.slug })),
        video: product.videoUrl ? {
          url: product.videoUrl,
          title: product.name?.en || product.slug,
          description: product.shortDescription?.en || product.name?.en || product.slug,
          thumbnailUrl: product.images.find((image) => image.type === 'video_thumbnail')?.url ||
            product.images.find((image) => image.url)?.url,
        } : null,
        priority: 0.7,
      })),
      segments: segmentPages.map((page) => {
        const segment = page.segment && typeof page.segment === 'object' ? page.segment : null;
        const segmentName = localize(segment?.name);
        return {
          url: `/segments/${page.slug}`,
          label: segmentName?.en || page.slug,
          translations: translatedLocales(page.metaTitle, page.metaDescription, segmentName),
          updated: page.updatedAt,
          priority: 0.7,
        };
      }),
      legal: legalPages.map((page) => ({
        url: `/${page.slug}`,
        label: localize(page.title)?.en || page.slug,
        translations: translatedLocales(page.title, page.metaTitle, page.metaDescription),
        updated: page.updatedAt,
        priority: 0.4,
      })),
      projects: projects.map((project) => ({
        url: `/projects/${project.slug}`,
        label: localize(project.title)?.en || project.slug,
        updated: project.updatedAt,
        images: (project.gallery || [])
          .map((entry) => entry.image)
          .filter((image) => image?.url)
          .map((image) => ({ url: image.url, title: localize(image.alt)?.en || localize(project.title)?.en || project.slug })),
        priority: 0.6,
      })),
      videos: videos.map((video) => ({
        url: `/videos/${video.id || video._id}`,
        label: localize(video.title)?.en || video.videoUrl,
        updated: video.updatedAt,
        video: video.thumbnail?.url ? {
          url: video.videoUrl,
          title: localize(video.title)?.en || 'Shadesology video',
          description: localize(video.description)?.en || '',
          thumbnailUrl: video.thumbnail.url,
        } : null,
        priority: 0.5,
      })),
    };
  }

  const [categories, products, segmentPages, legalPages, projects, videos, inspirationItems] = await Promise.all([
    Category.find({ isActive: true }).select('name metaTitle metaDescription slug updatedAt').sort('sortOrder').lean(),
    Product.find({ isActive: true }).select('name shortDescription metaTitle metaDescription slug images videoUrl updatedAt').sort('sortOrder').lean(),
    SegmentPage.find({ isActive: true, status: 'published' })
      .select('slug metaTitle metaDescription updatedAt')
      .populate('segment', 'name')
      .lean(),
    LegalPage.find({ isActive: true, noindex: false })
      .select('title metaTitle metaDescription slug pageType updatedAt')
      .lean(),
    Project.find(publishedReadFilter({ isActive: true, status: 'published' }))
      .select('title slug gallery updatedAt')
      .lean(),
    Video.find(publishedReadFilter({ isActive: true, status: 'published' }))
      .select('videoUrl title description thumbnail updatedAt')
      .lean(),
    InspirationItem.find(publishedReadFilter({ isActive: true, status: 'published' }))
      .select('title slug image alt updatedAt')
      .lean(),
  ]);

  return {
    static: [
      { url: '/',             label: 'Home',          priority: 1.0 },
      {
        url: '/inspiration',
        label: 'Inspiration',
        priority: 0.8,
        images: inspirationItems.filter((item) => item.image?.url).map((item) => ({
          url: item.image.url,
          title: item.alt?.en || item.image.alt?.en || item.title?.en || item.slug,
        })),
      },
      { url: '/projects',     label: 'Project Gallery',priority: 0.8 },
      { url: '/videos',       label: 'Video Library', priority: 0.7 },
      { url: '/quote',        label: 'Request a Quote', priority: 0.9 },
      { url: '/find-installer',label:'Find an Installer',priority: 0.8 },
      { url: '/contact',      label: 'Contact Us',    priority: 0.8 },
      { url: '/about',        label: 'About',         priority: 0.7 },
      { url: '/blog',         label: 'Blog',          priority: 0.7 },
      { url: '/support',      label: 'Support Center',priority: 0.7 },
    ],
    categories: categories.map((c) => ({
      url:      `/category/${c.slug}`,
      label:    c.name.en,
      translations: translatedLocales(c.name, c.metaTitle, c.metaDescription),
      updated:  c.updatedAt,
      priority: 0.8,
    })),
    products: products.map((p) => ({
      url:      `/products/${p.slug}`,
      label:    p.name.en,
      translations: translatedLocales(p.name, p.metaTitle, p.metaDescription),
      updated:  p.updatedAt,
      images: (p.images || [])
        .filter((image) => image.url)
        .map((image) => ({ url: image.url, title: image.alt?.en || p.name.en || p.slug })),
      video: p.videoUrl ? {
        url: p.videoUrl,
        title: p.name.en || p.slug,
        description: p.shortDescription?.en || p.name.en || p.slug,
        thumbnailUrl: p.images?.find((image) => image.type === 'video_thumbnail')?.url ||
          p.images?.find((image) => image.url)?.url,
      } : null,
      priority: 0.7,
    })),
    segments: segmentPages.map((s) => ({
      url:      `/segments/${s.slug}`,
      label:    s.segment ? s.segment.name.en : s.slug,
      translations: translatedLocales(s.metaTitle, s.metaDescription, s.segment?.name),
      updated:  s.updatedAt,
      priority: 0.7,
    })),
    legal: legalPages.map((p) => ({
      url:      `/${p.slug}`,
      label:    p.title.en,
      translations: translatedLocales(p.title, p.metaTitle, p.metaDescription),
      updated:  p.updatedAt,
      priority: 0.4,
    })),
    projects: projects.map((project) => ({
      url: `/projects/${project.slug}`,
      label: project.title?.en || project.slug,
      updated: project.updatedAt,
      images: (project.gallery || [])
        .filter((image) => image.url)
        .map((image) => ({ url: image.url, title: image.alt?.en || project.title?.en || project.slug })),
      priority: 0.6,
    })),
    videos: videos.map((video) => ({
      url: `/videos/${video._id}`,
      label: video.title?.en || video.videoUrl,
      updated: video.updatedAt,
      video: video.thumbnail?.url ? {
        url: video.videoUrl,
        title: video.title?.en || 'Shadesology video',
        description: video.description?.en || '',
        thumbnailUrl: video.thumbnail.url,
      } : null,
      priority: 0.5,
    })),
  };
};

// ─── HTML sitemap (JSON for frontend rendering) ───────────────────────────────
const htmlSitemap = async (req, res, next) => {
  try {
    const data = await buildSitemapData();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// ─── XML sitemap ──────────────────────────────────────────────────────────────
const xmlSitemap = async (req, res, next) => {
  try {
    const data = await buildSitemapData();

    const sourceUrls = [
      ...data.static.map((u) => ({ ...u, updated: new Date().toISOString() })),
      ...data.categories,
      ...data.products,
      ...data.segments,
      ...data.legal,
      ...(data.projects || []),
      ...(data.videos || []),
    ];
    const allUrls = sourceUrls.flatMap((entry) => {
      const locales = ['en', ...(entry.translations || [])];
      const localizedUrls = locales.map((locale) => ({
        ...entry,
        url: `${BASE_URL}${locale === 'en' ? '' : `/${locale}`}${entry.url === '/' && locale !== 'en' ? '' : entry.url}`,
      }));
      return localizedUrls.map((localized) => ({
        ...localized,
        alternates: locales.map((locale) => {
          const localizedPath = `${BASE_URL}${locale === 'en' ? '' : `/${locale}`}${entry.url === '/' && locale !== 'en' ? '' : entry.url}`;
          return { language: locale === 'en' ? 'en' : LOCALE_TAGS[locale], url: localizedPath };
        }),
      }));
    });

    const urlEntries = allUrls
      .map(({ url, updated, priority, alternates, images = [], video }) => `
  <url>
    <loc>${escapeXml(url.startsWith('http') ? url : `${BASE_URL}${url}`)}</loc>
    <lastmod>${updated ? new Date(updated).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}</lastmod>
    <priority>${(priority || 0.5).toFixed(1)}</priority>
    ${alternates.map(({ language, url: alternateUrl }) => `<xhtml:link rel="alternate" hreflang="${escapeXml(language)}" href="${escapeXml(alternateUrl)}" />`).join('')}
    ${images.map((image) => `<image:image><image:loc>${escapeXml(image.url)}</image:loc><image:title>${escapeXml(image.title)}</image:title></image:image>`).join('')}
    ${video?.thumbnailUrl ? `<video:video><video:thumbnail_loc>${escapeXml(video.thumbnailUrl)}</video:thumbnail_loc><video:title>${escapeXml(video.title)}</video:title><video:description>${escapeXml(video.description)}</video:description><video:player_loc>${escapeXml(video.url)}</video:player_loc></video:video>` : ''}
  </url>`)
      .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urlEntries}
</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    next(err);
  }
};

const escapeXml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

module.exports = { buildSitemapData, htmlSitemap, xmlSitemap };
