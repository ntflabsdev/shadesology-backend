/**
 * filterBuilder — converts URL query params into a Mongoose filter object
 * and builds the list of available facets from AttributeDefinition docs.
 *
 * This is the ONLY place filter logic lives.
 * Adding a new AttributeDefinition with useAsFilter:true automatically
 * creates a new filter on all category pages — no code changes needed.
 */

const AttributeDefinition = require('../models/AttributeDefinition');

/**
 * getFilterDefinitions — fetch all active AttributeDefinitions that are
 * marked useAsFilter:true, optionally scoped to a specific product type.
 *
 * @param {string|null} productTypeId
 * @returns {Array} array of AttributeDefinition lean docs
 */
const getFilterDefinitions = async (productTypeId = null) => {
  const query = { useAsFilter: true, isActive: true };

  if (productTypeId) {
    // Show filters that apply to this product type OR have no type restriction
    query.$or = [
      { productTypes: { $size: 0 } },
      { productTypes: productTypeId },
    ];
  }

  return AttributeDefinition.find(query).sort('sortOrder').lean();
};

/**
 * buildProductFilter — converts URL query params into a Mongoose $and filter.
 *
 * Each attribute is stored in Product.attributes as a Map.
 * We query it with: { `attributes.${key}`: value }
 *
 * Supported types:
 *   select / multi_select — exact match or $in
 *   range                 — { $gte: min, $lte: max }
 *   boolean               — cast to boolean
 *   number                — cast to number
 *   text                  — $regex case-insensitive
 *
 * @param {Object} query      - Express req.query
 * @param {Array}  attrDefs   - AttributeDefinition docs (from getFilterDefinitions)
 * @returns {Object}          - Mongoose filter fragment
 */
const buildProductFilter = (query, attrDefs) => {
  const filter = {};

  for (const def of attrDefs) {
    const val = query[def.key];
    if (val === undefined || val === '' || val === null) continue;

    const fieldPath = `attributes.${def.key}`;

    switch (def.type) {
      case 'select': {
        // Single select — exact match
        filter[fieldPath] = val;
        break;
      }

      case 'multi_select': {
        // Comma-separated values → $in
        const values = Array.isArray(val) ? val : val.split(',').map((v) => v.trim());
        if (values.length > 0) {
          filter[fieldPath] = { $in: values };
        }
        break;
      }

      case 'range': {
        // Expects: ?width_range=84,120  (min,max in inches)
        const parts = val.split(',').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          filter[fieldPath] = { $gte: parts[0], $lte: parts[1] };
        } else if (parts.length === 1 && !isNaN(parts[0])) {
          filter[fieldPath] = { $gte: parts[0] };
        }
        break;
      }

      case 'boolean': {
        filter[fieldPath] = val === 'true' || val === '1';
        break;
      }

      case 'number': {
        const num = Number(val);
        if (!isNaN(num)) filter[fieldPath] = num;
        break;
      }

      case 'text': {
        filter[fieldPath] = { $regex: val, $options: 'i' };
        break;
      }

      default:
        break;
    }
  }

  return filter;
};

/**
 * buildFacetsResponse — builds the facet list for the frontend filter panel.
 *
 * Returns each filterable attribute with its display config and, for
 * select/multi_select types, the available options.
 *
 * @param {Array}  attrDefs    - AttributeDefinition docs
 * @param {Object} activeFilters - Currently active filter key→value map
 * @returns {Array}
 */
const buildFacetsResponse = (attrDefs, activeFilters = {}) => {
  return attrDefs.map((def) => ({
    key:          def.key,
    label:        def.name,             // translatable object
    type:         def.type,
    displayType:  def.filterDisplayType,
    unit:         def.unit,
    unitMetric:   def.unitMetric,
    options:      def.options || [],
    activeValue:  activeFilters[def.key] || null,
    sortOrder:    def.sortOrder,
  }));
};

/**
 * getIndexationRule — determines whether a URL with given active filters
 * should be crawlable (canonical) or noindex.
 *
 * Rules (from CategoryContent.crawlableFilterKeys):
 *   - No filters active       → index (canonical = base category URL)
 *   - Exactly 1 filter active AND that filter key is in crawlableFilterKeys → index
 *   - Any other combination   → noindex, canonical = base category URL
 *
 * @param {string[]} crawlableFilterKeys  - from CategoryContent doc
 * @param {Object}   activeFilters        - key→value from query params
 * @param {string}   baseCanonical        - e.g. '/category/retractable-awning'
 * @returns {{ index: boolean, canonical: string }}
 */
const getIndexationRule = (crawlableFilterKeys = [], activeFilters = {}, baseCanonical = '') => {
  const activeKeys = Object.keys(activeFilters).filter(
    (k) => activeFilters[k] !== undefined && activeFilters[k] !== ''
  );

  // No filters — always index
  if (activeKeys.length === 0) {
    return { index: true, canonical: baseCanonical };
  }

  // Exactly one filter AND it's in the crawlable list → index
  if (activeKeys.length === 1 && crawlableFilterKeys.includes(activeKeys[0])) {
    return { index: true, canonical: null }; // null = no canonical override needed
  }

  // Everything else → noindex, point canonical to base
  return { index: false, canonical: baseCanonical };
};

/**
 * parseActiveFilters — extract only the filter-relevant keys from query params.
 *
 * @param {Object} query     - Express req.query
 * @param {Array}  attrDefs  - AttributeDefinition docs
 * @returns {Object}         - { mount_type: 'wall', operation: 'motorized' }
 */
const parseActiveFilters = (query, attrDefs) => {
  const active = {};
  for (const def of attrDefs) {
    if (query[def.key] !== undefined && query[def.key] !== '') {
      active[def.key] = query[def.key];
    }
  }
  return active;
};

module.exports = {
  getFilterDefinitions,
  buildProductFilter,
  buildFacetsResponse,
  getIndexationRule,
  parseActiveFilters,
};
