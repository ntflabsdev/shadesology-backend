'use strict';

const { createError } = require('../middlewares/errorHandler');
const { createPayloadContentClient } = require('./payloadContent');

function editorialSource() {
  const source = process.env.EDITORIAL_CONTENT_SOURCE || 'mongoose';
  if (!['mongoose', 'payload'].includes(source)) {
    throw createError(500, 'EDITORIAL_CONTENT_SOURCE must be mongoose or payload.');
  }
  return source;
}

function isPayloadEditorialSource() {
  return editorialSource() === 'payload';
}

function publishedReadFilter(filter = {}) {
  return {
    $and: [
      filter,
      { $or: [{ _status: 'published' }, { _status: { $exists: false } }] },
    ],
  };
}

function payloadClient() {
  return createPayloadContentClient();
}

function localized(value) {
  if (value === null || value === undefined || typeof value === 'object') {
    return value;
  }
  return { en: value };
}

function uploadUrl(upload) {
  if (!upload || typeof upload !== 'object') {
    return '';
  }
  return upload.url || '';
}

function mapHomepage(global) {
  const types = {
    hero: 'hero',
    'product-overview': 'product_overview',
    'segments-grid': 'segments_grid',
    'featured-products': 'featured_products',
    'featured-projects': 'featured_projects',
    'trust-band': 'trust_band',
    'installer-locator': 'installer_locator',
    'rich-content': 'rich_content',
  };

  return (global.sections || []).flatMap((section, sortOrder) => {
    const type = types[section.blockType];
    if (!type) {
      return [];
    }

    const image = section.image || section.backgroundImage;
    const sectionData = {
      _id: section.id || `${section.blockType}-${sortOrder}`,
      type,
      adminLabel: section.adminLabel || section.blockName || section.blockType,
      sortOrder,
      isActive: section.enabled !== false,
    };

    if (section.headline !== undefined) {
      sectionData.headline = localized(section.headline);
    }
    if (section.subheadline !== undefined) {
      sectionData.subheadline = localized(section.subheadline);
    }
    if (section.primaryCta) {
      sectionData.cta1 = { ...section.primaryCta, style: 'primary' };
    }
    if (section.secondaryCta) {
      sectionData.cta2 = { ...section.secondaryCta, style: 'outline' };
    }
    if (image) {
      sectionData.backgroundImage = {
        url: uploadUrl(image) || section.legacyImageUrl || '',
        alt: localized(section.imageAlt || image?.alt),
        mobileUrl: uploadUrl(section.mobileImage) || section.legacyMobileImageUrl || '',
      };
    }
    if (section.heading !== undefined) {
      sectionData.sectionTitle = localized(section.heading);
    }
    if (section.intro !== undefined) {
      sectionData.sectionSubtitle = localized(section.intro);
    }
    if (section.itemLimit !== undefined) {
      sectionData.itemLimit = section.itemLimit;
    }
    if (section.products) {
      sectionData.featuredProducts = section.products;
    }
    if (section.projects) {
      sectionData.featuredProjects = section.projects;
    }
    if (section.items) {
      sectionData.trustItems = section.items.map((item, index) => ({
        ...item,
        label: localized(item.label),
        value: localized(item.value),
        sortOrder: index,
      }));
    }
    if (section.body !== undefined) {
      sectionData.payloadRichText = section.body;
    }

    return [sectionData];
  });
}

function mapNavigation(global, categories = []) {
  return {
    type: 'main',
    items: (global.items || [])
      .filter((item) => item.enabled !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((item) => {
        const overrides = item.children || [];
        const overrideByCategory = new Map(
          overrides
            .filter((child) => child.category)
            .map((child) => [String(child.category.id || child.category._id || child.category), child]),
        );
        const children = item.autoCatalog
          ? categories.map((category) => {
            const override = overrideByCategory.get(String(category._id)) || {};
            return {
              heading: override.heading || category.name,
              category: category._id,
              url: override.url || `/category/${category.slug}`,
              image: override.image || category.image || { url: '', alt: { en: '' } },
              children: override.children || [],
              isActive: override.enabled !== false,
              sortOrder: override.sortOrder ?? category.sortOrder ?? 0,
            };
          }).concat(overrides.filter((child) => !child.category))
          : overrides;

        return {
          label: localized(item.label),
          url: item.url || '',
          type: item.type || (children.length ? 'dropdown' : 'link'),
          autoCatalog: item.autoCatalog === true,
          isActive: true,
          sortOrder: item.sortOrder || 0,
          children: children
          .filter((child) => child.enabled !== false)
          .map((child, index) => ({
            heading: localized(child.heading || child.label),
            category: child.category,
            url: child.url || '',
            image: {
              url: uploadUrl(child.image?.image || child.image) || child.image?.legacyImageUrl || '',
              alt: localized(child.image?.alt),
            },
            children: (child.children || [])
              .filter((link) => link.enabled !== false)
              .map((link, linkIndex) => ({
                label: localized(link.label),
                url: link.url || '',
                isActive: true,
                sortOrder: link.sortOrder ?? linkIndex,
              })),
            isActive: true,
            sortOrder: child.sortOrder ?? index,
          })),
        ctas: item.ctas || [],
        };
      }),
  };
}

function mapMobileNavigation(global) {
  const items = global.mobileItems?.length
    ? global.mobileItems
    : global.items || [];
  return {
    type: 'mobile',
    items: items
      .filter((item) => item.enabled !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((item) => ({
        label: localized(item.label),
        url: item.url || '',
        children: (item.children || [])
          .filter((child) => child.enabled !== false)
          .map((child) => ({
            label: localized(child.heading || child.label),
            url: child.url || '',
            children: child.children || [],
          })),
        sortOrder: item.sortOrder || 0,
      })),
  };
}

function mapFooter(global) {
  return {
    linkGroups: (global.linkGroups || [])
      .map((group, index) => ({
        _id: group.id || `footer-group-${index}`,
        heading: localized(group.heading),
        isActive: true,
        sortOrder: group.sortOrder ?? index,
        links: (group.links || [])
          .filter((link) => link.enabled !== false)
          .map((link) => ({
            label: localized(link.label),
            url: link.url || '',
            isExternal: /^https:\/\//i.test(link.url || ''),
            isActive: true,
          })),
      })),
    phone: global.phone || '',
    email: global.email || '',
    address: localized(global.address),
    socialLinks: (global.socialLinks || [])
      .filter((link) => link.enabled !== false)
      .map((link, index) => ({
        platform: link.platform,
        url: link.url,
        isActive: true,
        sortOrder: index,
      })),
    instagramFeed: (global.instagramFeed || [])
      .filter((item) => item.enabled !== false)
      .map((item, index) => ({
        imageUrl: uploadUrl(item.image) || item.imageUrl,
        imageAlt: item.imageAlt || '',
        permalink: item.permalink || '',
        caption: item.caption || '',
        isActive: true,
        sortOrder: index,
      })),
    newsletterHeading: localized(global.newsletterHeading),
    newsletterSubheading: localized(global.newsletterSubheading),
    newsletterEnabled: global.newsletterEnabled !== false,
    copyrightText: localized(global.copyright),
    legalLinks: (global.legalLinks || []).map((link) => ({
      label: localized(link.label),
      url: link.url,
    })),
    locations: global.locations || [],
  };
}

function migrateLegacyHomepage(sections) {
  const blockTypes = {
    hero: 'hero',
    product_overview: 'product-overview',
    segments_grid: 'segments-grid',
    featured_products: 'featured-products',
    featured_projects: 'featured-projects',
    trust_band: 'trust-band',
    installer_locator: 'installer-locator',
  };
  const unsupported = sections
    .filter((section) => !blockTypes[section.type])
    .map((section) => ({ id: String(section._id), type: section.type }));
  const blocks = sections.flatMap((section) => {
    const blockType = blockTypes[section.type];
    if (!blockType) {
      return [];
    }
    return [{
      blockType,
      adminLabel: section.adminLabel || section.type,
      enabled: section.isActive !== false,
      headline: section.headline,
      subheadline: section.subheadline,
      primaryCta: section.cta1,
      secondaryCta: section.cta2,
      legacyImageUrl: section.backgroundImage?.url || '',
      legacyMobileImageUrl: section.backgroundImage?.mobileUrl || '',
      imageAlt: section.backgroundImage?.alt,
      backgroundVideoUrl: section.backgroundVideoUrl || '',
      backgroundColor: section.backgroundColor || '',
      paddingVariant: section.paddingVariant || 'md',
      heading: section.sectionTitle,
      intro: section.sectionSubtitle,
      itemLimit: section.itemLimit,
      products: (section.featuredProducts || []).map(String),
      projects: (section.featuredProjects || []).map(String),
      items: (section.trustItems || []).map(({ icon, label, value }) => ({ icon, label, value })),
    }];
  });
  return { data: { sections: blocks }, unsupported };
}

function migrateLegacyNavigation(mainMenu, mobileMenu) {
  const mapItem = (item) => ({
    label: item.label,
    url: item.url || '',
    type: item.type || 'link',
    autoCatalog: Boolean(item.autoCatalog),
    enabled: item.isActive !== false,
    sortOrder: item.sortOrder || 0,
    children: (item.children || []).map((child) => ({
      heading: child.heading,
      category: child.category ? String(child.category) : null,
      url: child.url || '',
      image: {
        legacyImageUrl: child.image?.url || '',
        alt: child.image?.alt,
      },
      enabled: child.isActive !== false,
      sortOrder: child.sortOrder || 0,
      children: (child.children || []).map((link) => ({
        label: link.label,
        url: link.url || '',
        icon: link.icon || '',
        badge: link.badge,
        enabled: link.isActive !== false,
        sortOrder: link.sortOrder || 0,
      })),
    })),
    ctas: item.ctas || [],
  });

  return {
    items: (mainMenu?.items || []).map(mapItem),
    mobileItems: (mobileMenu?.items || []).map((item) => ({
      label: item.label,
      url: item.url || '',
      enabled: item.isActive !== false,
      sortOrder: item.sortOrder || 0,
    })),
  };
}

function migrateLegacyFooter(footer) {
  if (!footer) {
    return {};
  }
  return {
    linkGroups: (footer.linkGroups || []).map((group) => ({
      heading: group.heading,
      sortOrder: group.sortOrder || 0,
      links: (group.links || []).map((link) => ({
        label: link.label,
        url: link.url,
        isExternal: Boolean(link.isExternal),
        enabled: link.isActive !== false,
        sortOrder: link.sortOrder || 0,
      })),
    })),
    phone: footer.phone || '',
    email: footer.email || '',
    address: footer.address,
    socialLinks: (footer.socialLinks || []).map((link) => ({
      platform: link.platform,
      url: link.url,
      enabled: link.isActive !== false,
    })),
    instagramFeed: (footer.instagramFeed || []).map((item) => ({
      imageUrl: item.imageUrl,
      imageAlt: item.imageAlt,
      permalink: item.permalink,
      caption: item.caption || '',
      enabled: item.isActive !== false,
    })),
    newsletterHeading: footer.newsletterHeading,
    newsletterSubheading: footer.newsletterSubheading,
    newsletterEnabled: footer.newsletterEnabled !== false,
    copyright: footer.copyrightText,
    legalLinks: (footer.legalLinks || []).map((link) => ({ label: link.label, url: link.url })),
    locations: (footer.locations || []).map((location) => ({
      name: location.name,
      address: location.address,
      phone: location.phone,
      email: location.email,
      mapEmbedUrl: location.mapEmbedUrl,
      enabled: location.isActive !== false,
    })),
  };
}

function mapSegment(segment) {
  return {
    _id: String(segment.id || segment._id),
    name: localized(segment.name),
    slug: segment.slug,
    code: segment.code,
    audience: segment.audience,
    description: localized(segment.description),
    icon: segment.icon,
    heroImage: segment.heroImage
      ? { url: uploadUrl(segment.heroImage), alt: localized(segment.heroImage.alt) }
      : null,
    sortOrder: segment.sortOrder || 0,
  };
}

function mapProductCard(product) {
  return {
    ...product,
    _id: String(product.id || product._id),
    images: (product.images || []).map((entry) => ({
      url: uploadUrl(entry.image) || entry.url || '',
      alt: localized(entry.alt || entry.image?.alt),
      type: entry.type || 'photo',
      sortOrder: entry.sortOrder || 0,
    })),
    category: typeof product.category === 'object' ? product.category : undefined,
    productType: typeof product.productType === 'object' ? product.productType : undefined,
  };
}

function mapCategory(category) {
  return {
    ...category,
    _id: String(category.id || category._id),
    name: localized(category.name),
    description: localized(category.description),
    metaTitle: localized(category.metaTitle),
    metaDescription: localized(category.metaDescription),
    image: category.image
      ? { url: uploadUrl(category.image), alt: localized(category.image.alt) }
      : null,
  };
}

function richText(value) {
  if (!value || typeof value !== 'object') {
    return localized(value);
  }
  if (!value.root && !value.children && !value.text) {
    return Object.fromEntries(
      Object.entries(value).map(([locale, content]) => [locale, richText(content).en]),
    );
  }
  const texts = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (typeof node.text === 'string') {
      texts.push(node.text);
    }
    for (const child of node.children || []) {
      visit(child);
    }
  };
  visit(value.root || value);
  return { en: texts.join(' ').trim() };
}

function mapSegmentPage(page) {
  const segment = typeof page.segment === 'object' ? mapSegment(page.segment) : null;
  return {
    _id: String(page.id || page._id),
    segment,
    slug: page.slug,
    heroHeadline: localized(page.heroHeadline),
    heroSubheadline: localized(page.heroSubheadline),
    heroImageUrl: uploadUrl(page.heroImage),
    heroImageAlt: localized(page.heroImage?.alt),
    heroCta: page.heroCta,
    contentBlocks: (page.contentBlocks || []).map((block, index) => ({
      type: block.blockType === 'text' ? 'rich_text' : block.blockType,
      heading: localized(block.heading),
      content: block.blockType === 'text' ? richText(block.body) : localized(block.label),
      sortOrder: index,
      isActive: true,
    })),
    featuredProducts: (page.featuredProducts || [])
      .filter((product) => typeof product === 'object')
      .map(mapProductCard),
    featuredProjects: (page.featuredProjects || []).filter((project) => typeof project === 'object'),
    productLimit: page.productLimit,
    enquiryQueue: page.enquiryQueue,
    relatedSegments: (page.relatedSegments || [])
      .filter((related) => typeof related === 'object')
      .map(mapSegment),
    metaTitle: localized(page.metaTitle),
    metaDescription: localized(page.metaDescription),
    status: 'published',
    isActive: true,
  };
}

async function getGlobal(slug, mapper) {
  const data = await payloadClient().findPublishedGlobal(slug, { locale: 'all', depth: 3 });
  return mapper(data);
}

async function getPublishedCollection(slug, options) {
  return payloadClient().findPublished(slug, { locale: 'all', depth: 3, ...options });
}

module.exports = {
  editorialSource,
  isPayloadEditorialSource,
  publishedReadFilter,
  getGlobal,
  getPublishedCollection,
  mapHomepage,
  mapNavigation,
  mapMobileNavigation,
  mapFooter,
  mapSegment,
  mapProductCard,
  mapCategory,
  mapSegmentPage,
  migrateLegacyHomepage,
  migrateLegacyNavigation,
  migrateLegacyFooter,
};
