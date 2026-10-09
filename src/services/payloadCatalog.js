'use strict';

const { createPayloadContentClient } = require('./payloadContent');
const toId = (value) => {
  if (value === null || value === undefined) {return null;}
  if (typeof value === 'object') {return String(value.id || value._id || '');}
  return String(value);
};

const localize = (value) => {
  if (value === null || value === undefined) {return value;}
  if (typeof value === 'string') {return { en: value };}
  return value;
};

const uploadUrl = (value) => {
  if (!value || typeof value !== 'object') {return '';}
  return value.url || '';
};

const productImage = (entry, index) => {
  const image = entry?.image || entry;
  return {
    url: uploadUrl(image) || entry?.url || '',
    alt: localize(entry?.alt || image?.alt),
    type: entry?.type || 'photo',
    sortOrder: entry?.sortOrder ?? index,
  };
};

const mapProductCard = (product) => ({
  ...product,
  _id: toId(product.id || product._id),
  name: localize(product.name),
  shortDescription: localize(product.shortDescription),
  images: (product.images || []).map(productImage),
  category: product.category && typeof product.category === 'object'
    ? { ...product.category, _id: toId(product.category), name: localize(product.category.name) }
    : undefined,
  productType: product.productType && typeof product.productType === 'object'
    ? { ...product.productType, _id: toId(product.productType), name: localize(product.productType.name) }
    : undefined,
});

const richText = (value) => {
  if (!value || typeof value !== 'object' || value.root || value.children) {
    if (value && typeof value === 'object' && (value.root || value.children)) {
      const text = [];
      const visit = (node) => {
        if (!node || typeof node !== 'object') {return;}
        if (typeof node.text === 'string') {text.push(node.text);}
        for (const child of node.children || []) {visit(child);}
      };
      visit(value.root || value);
      return { en: text.join(' ').trim() };
    }
    return localize(value);
  }
  return Object.fromEntries(
    Object.entries(value).map(([locale, content]) => [locale, richText(content)?.en || '']),
  );
};

const mapProduct = (product) => {
  const card = mapProductCard(product);
  const related = (product.relatedProducts || [])
    .filter((entry) => entry && typeof entry === 'object')
    .map(mapProductCard);
  const relationshipList = (entries) => (entries || [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({ ...entry, _id: toId(entry.id || entry._id), name: localize(entry.name) }));
  return {
    ...card,
    description: richText(product.description),
    features: (product.features || []).map((feature) => ({ ...feature, text: localize(feature.text) })),
    videoUrl: product.videoUrl || '',
    videos: (product.videos || [])
      .filter((video) => video && typeof video === 'object' && video.isActive !== false)
      .map((video) => ({
        _id: toId(video.id || video._id),
        videoUrl: video.videoUrl || '',
        title: localize(video.title),
        description: localize(video.description),
        category: video.category || 'demo',
        thumbnail: video.thumbnail?.url
          ? { url: video.thumbnail.url, alt: localize(video.thumbnail.alt) }
          : null,
        chapters: video.chapters || [],
        transcript: localize(video.transcript),
        captionsUrl: video.captionsUrl || '',
        products: [],
        createdAt: video.createdAt || null,
      })),
    spinImages: (product.spinImages || []).map((image) => image.url || image),
    fabrics: relationshipList(product.fabrics).map((fabric) => ({
      ...fabric,
      images: (fabric.images || []).map((image) => ({ url: uploadUrl(image.image || image) })),
    })),
    colors: relationshipList(product.colors).map((color) => ({
      ...color,
      hexValue: color.hexValue || color.hex,
      swatchImage: uploadUrl(color.swatch || color.swatchImage),
    })),
    relatedProducts: related,
    accessories: relationshipList(product.accessories).map((accessory) => ({
      ...accessory,
      images: (accessory.images || []).map((image) => ({ url: uploadUrl(image.image || image) })),
    })),
    metaTitle: localize(product.metaTitle),
    metaDescription: localize(product.metaDescription),
    isFeatured: product.isFeatured === true,
    isNewArrival: product.isNewArrival === true,
    manufacturer: product.manufacturer && typeof product.manufacturer === 'object'
      ? { ...product.manufacturer, _id: toId(product.manufacturer), name: localize(product.manufacturer.name), logo: uploadUrl(product.manufacturer.logo) }
      : undefined,
    segments: relationshipList(product.segments),
  };
};

const mapVariant = (variant) => {
  const dimensions = variant.dimensions || {};
  return {
    ...variant,
    _id: toId(variant.id || variant._id),
    product: toId(variant.product),
    name: localize(variant.name),
    widthMin: variant.widthMin ?? dimensions.widthMin ?? dimensions.width?.min ?? null,
    widthMax: variant.widthMax ?? dimensions.widthMax ?? dimensions.width?.max ?? null,
    projectionMin: variant.projectionMin ?? dimensions.projectionMin ?? dimensions.projection?.min ?? null,
    projectionMax: variant.projectionMax ?? dimensions.projectionMax ?? dimensions.projection?.max ?? null,
    leadTimeNote: localize(variant.leadTimeNote),
    images: (variant.images || []).map(productImage),
    allowedOptionGroups: variant.allowedOptionGroups || [],
  };
};

const relationContains = (relation, expectedId) => {
  const expected = toId(expectedId);
  return (Array.isArray(relation) ? relation : [relation]).some((entry) => toId(entry) === expected);
};

const textForSearch = (value) => {
  if (typeof value === 'string') {return value;}
  if (Array.isArray(value)) {return value.map(textForSearch).join(' ');}
  if (!value || typeof value !== 'object') {return '';}
  return Object.values(value).map(textForSearch).join(' ');
};

const matchesText = (value, query) => textForSearch(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());

const matchesAttribute = (actual, requested, definition) => {
  if (requested === undefined || requested === '' || requested === null) {return true;}
  const values = Array.isArray(requested) ? requested : String(requested).split(',').map((part) => part.trim());
  switch (definition.type) {
    case 'range': {
      const bounds = String(requested).split(',').map(Number);
      const actualNumber = Number(actual);
      return Number.isFinite(actualNumber) && actualNumber >= bounds[0] &&
        (bounds.length < 2 || !Number.isFinite(bounds[1]) || actualNumber <= bounds[1]);
    }
    case 'number':
      return Number(actual) === Number(requested);
    case 'boolean':
      return Boolean(actual) === (requested === 'true' || requested === '1');
    case 'text':
      return matchesText(actual, String(requested));
    case 'multi_select':
      return values.some((value) => (Array.isArray(actual) ? actual : [actual]).map(String).includes(value));
    default:
      return values.map(String).includes(String(actual));
  }
};

const mapAttributeDefinition = (definition) => ({
  ...definition,
  _id: toId(definition.id || definition._id),
  name: localize(definition.label || definition.name),
  type: definition.type === 'select' && definition.allowMultiple ? 'multi_select' : definition.type,
  useAsFilter: definition.filterable ?? definition.useAsFilter ?? definition.useInFilters ?? false,
  filterDisplayType: definition.filterDisplayType || definition.displayType,
  productTypes: definition.productTypes || [],
  options: (definition.options || []).map((option) => ({
    ...option,
    label: localize(option.label || option.name),
  })),
});

const mapCategory = (category) => ({
  ...category,
  _id: toId(category.id || category._id),
  name: localize(category.name),
  description: richText(category.description),
  metaTitle: localize(category.metaTitle),
  metaDescription: localize(category.metaDescription),
  image: category.image
    ? { url: uploadUrl(category.image), alt: localize(category.image.alt) }
    : null,
  productTypes: (category.productTypes || [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({ ...entry, _id: toId(entry.id || entry._id), name: localize(entry.name) })),
});

const sortProducts = (products, sort) => {
  const compareLocalized = (left, right) => {
    const a = textForSearch(left).toLocaleLowerCase();
    const b = textForSearch(right).toLocaleLowerCase();
    return a.localeCompare(b);
  };
  return [...products].sort((a, b) => {
    if (sort === 'newest') {return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);}
    if (sort === 'name_asc') {return compareLocalized(a.name, b.name);}
    if (sort === 'name_desc') {return compareLocalized(b.name, a.name);}
    if (sort === 'popular') {return Number(b.viewCount || 0) - Number(a.viewCount || 0);}
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });
};

function createPayloadCatalog({ getClient = createPayloadContentClient } = {}) {
  const client = () => getClient();
  return {
    getProducts: (options) => client().findAllPublished('products', { depth: 4, ...options }),
    getProduct: async (slug) => {
      const result = await client().findPublished('products', {
        depth: 4,
        limit: 1,
        where: { 'slug[equals]': slug, 'isActive[equals]': true },
      });
      return result.docs?.[0] || null;
    },
    getVariants: (productId) => client().findAllPublished('variants', {
      depth: 4,
      where: { 'product[equals]': productId, 'isActive[equals]': true },
    }),
    getVariantsForProducts: (productIds) => productIds.length
      ? client().findAllPublished('variants', {
        depth: 2,
        where: { 'product[in]': productIds.join(','), 'isActive[equals]': true },
      })
      : Promise.resolve([]),
    getCategories: (options) => client().findAllPublished('categories', { depth: 3, ...options }),
    getCategory: async (slug) => {
      const result = await client().findPublished('categories', {
        depth: 4,
        limit: 1,
        where: { 'slug[equals]': slug, 'isActive[equals]': true },
      });
      return result.docs?.[0] || null;
    },
    getAttributeDefinitions: async () => (await client().findAllPublished('attribute-definitions', { depth: 2 }))
      .map(mapAttributeDefinition)
      .filter((definition) => definition.useAsFilter),
    getCategoryContent: async (categoryId) => {
      const result = await client().findPublished('category-content', {
        depth: 3,
        limit: 1,
        where: { 'category[equals]': categoryId },
      });
      return result.docs?.[0] || null;
    },
    getProductContent: async (productId) => {
      const result = await client().findPublished('product-content', {
        depth: 4,
        limit: 1,
        where: { 'product[equals]': productId },
      });
      return result.docs?.[0] || null;
    },
    getPublished: (slug, options) => client().findAllPublished(slug, { depth: 3, ...options }),
  };
}

module.exports = {
  createPayloadCatalog,
  mapProductCard,
  mapProduct,
  mapVariant,
  mapCategory,
  mapAttributeDefinition,
  relationContains,
  textForSearch,
  matchesText,
  matchesAttribute,
  sortProducts,
  toId,
  localize,
  uploadUrl,
  richText,
};
