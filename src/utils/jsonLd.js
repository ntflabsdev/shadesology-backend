/**
 * jsonLd — generates Product/Offer/availability JSON-LD from catalog data.
 *
 * Used by the product controller to embed structured data in API responses.
 * The frontend renders this as <script type="application/ld+json">.
 *
 * Schema: https://schema.org/Product
 */

const BASE_URL = process.env.FRONTEND_URL || 'https://shadesology.com';

/**
 * Availability mapping from our enum to schema.org values
 */
const AVAILABILITY_MAP = {
  in_stock:      'https://schema.org/InStock',
  made_to_order: 'https://schema.org/MadeToOrder',
  discontinued:  'https://schema.org/Discontinued',
  coming_soon:   'https://schema.org/PreOrder',
};

/**
 * buildProductJsonLd — generates a Product schema with Offer array.
 *
 * @param {Object} product      — lean Product doc
 * @param {Array}  variants     — lean Variant docs for this product
 * @param {Object} manufacturer — lean Manufacturer doc (optional)
 * @param {Array}  reviews      — lean Review docs (for AggregateRating)
 * @returns {Object}            — JSON-LD object (not stringified)
 */
const buildProductJsonLd = (product, variants = [], manufacturer = null, reviews = []) => {
  // ── AggregateRating (only if reviews exist) ───────────────────────────────
  let aggregateRating;
  if (reviews.length > 0) {
    const approved = reviews.filter((r) => r.status === 'approved');
    if (approved.length > 0) {
      const avg = approved.reduce((sum, r) => sum + r.rating, 0) / approved.length;
      aggregateRating = {
        '@type':       'AggregateRating',
        ratingValue:   avg.toFixed(1),
        reviewCount:   approved.length,
        bestRating:    5,
        worstRating:   1,
      };
    }
  }

  // ── Offers (one per active variant) ──────────────────────────────────────
  const offers = variants
    .filter((v) => v.isActive && v.availability !== 'discontinued')
    .map((v) => ({
      '@type':           'Offer',
      name:              v.name && v.name.en ? v.name.en : '',
      sku:               v.sku,
      price:             v.basePrice,
      priceCurrency:     'USD',
      availability:      AVAILABILITY_MAP[v.availability] || 'https://schema.org/InStock',
      itemCondition:     'https://schema.org/NewCondition',
      seller: {
        '@type': 'Organization',
        name:    'Shadesology',
        url:     BASE_URL,
      },
    }));

  // ── Product images ────────────────────────────────────────────────────────
  const images = (product.images || [])
    .filter((img) => img.url)
    .map((img) => img.url);

  // ── Brand ─────────────────────────────────────────────────────────────────
  const brand = manufacturer
    ? { '@type': 'Brand', name: manufacturer.name }
    : { '@type': 'Brand', name: 'Shadesology' };

  // ── Schema object ─────────────────────────────────────────────────────────
  const schema = {
    '@context':   'https://schema.org',
    '@type':      'Product',
    name:         product.name && product.name.en ? product.name.en : '',
    description:  product.shortDescription && product.shortDescription.en
                    ? product.shortDescription.en
                    : '',
    image:        images,
    brand,
    url:          `${BASE_URL}/products/${product.slug}`,
    offers:       offers.length === 1 ? offers[0] : offers,
  };

  if (aggregateRating) schema.aggregateRating = aggregateRating;

  // ── Staff schema overrides (from Product.schemaOverrides) ─────────────────
  if (product.schemaOverrides && Object.keys(product.schemaOverrides).length > 0) {
    Object.assign(schema, product.schemaOverrides);
  }

  return schema;
};

/**
 * buildBreadcrumbJsonLd — generates BreadcrumbList schema.
 *
 * @param {Array} items — [{ name, url }]
 * @returns {Object}
 */
const buildBreadcrumbJsonLd = (items = []) => ({
  '@context': 'https://schema.org',
  '@type':    'BreadcrumbList',
  itemListElement: items.map((item, idx) => ({
    '@type':    'ListItem',
    position:   idx + 1,
    name:       item.name,
    item:       item.url ? `${BASE_URL}${item.url}` : undefined,
  })),
});

module.exports = { buildProductJsonLd, buildBreadcrumbJsonLd };
