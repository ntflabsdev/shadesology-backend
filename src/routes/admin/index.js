/**
 * Admin router — mounts all /admin sub-routes.
 * All routes are protected by requireStaff middleware applied here once.
 */
const express = require('express');
const { requireStaff } = require('../../middlewares/requireRole');
const { isPayloadEditorialSource } = require('../../services/payloadPublicContent');
const { createError } = require('../../middlewares/errorHandler');

const router = express.Router();

// ─── Staff auth guard on all /admin routes ────────────────────────────────────
router.use(requireStaff);

const payloadManagedCollections = [
  '/homepage',
  '/segment-pages',
  '/nav',
  '/footer',
  '/legal-pages',
  '/category-content',
  '/product-content',
  '/product-types',
  '/categories',
  '/manufacturers',
  '/segments',
  '/attribute-definitions',
  '/products',
  '/variants',
  '/fabrics',
  '/colors',
  '/option-groups',
  '/accessories',
  '/documents',
  '/faqs',
  '/reviews',
  '/projects',
  '/inspiration-items',
  '/videos',
  '/redirects',
];

router.use(payloadManagedCollections, (req, res, next) => {
  if (isPayloadEditorialSource()) {
    return next(createError(410, 'This editorial resource is managed in Payload CMS.'));
  }
  return next();
});

// ─── Resource routes ──────────────────────────────────────────────────────────
router.use('/users',                 require('./users'));
router.use('/portals',               require('./portals'));
router.use('/approvals',             require('./approvals'));
router.use('/homepage',              require('./homepage'));
router.use('/segment-pages',         require('./segmentPages'));
router.use('/nav',                   require('./nav'));
router.use('/footer',                require('./footer'));
router.use('/legal-pages',           require('./legalPages'));
router.use('/newsletter',            require('./newsletter'));
router.use('/category-content',      require('./categoryContent'));
router.use('/product-content',       require('./productContent'));
router.use('/product-types',         require('./productTypes'));
router.use('/categories',            require('./categories'));
router.use('/manufacturers',         require('./manufacturers'));
router.use('/segments',              require('./segments'));
router.use('/attribute-definitions', require('./attributeDefinitions'));
router.use('/products',              require('./products'));
router.use('/variants',              require('./variants'));
router.use('/fabrics',               require('./fabrics'));
router.use('/colors',                require('./colors'));
router.use('/option-groups',         require('./optionGroups'));
router.use('/accessories',           require('./accessories'));
router.use('/documents',             require('./documents'));
router.use('/faqs',                  require('./faqs'));
router.use('/reviews',               require('./reviews'));
router.use('/projects',              require('./projects'));
router.use('/inspiration-items',     require('./inspirationItems'));
router.use('/videos',                require('./videos'));
router.use('/redirects',             require('./redirects'));
router.use('/quotes',                require('./quotes'));
router.use('/installers',            require('./installers'));
router.use('/orders',                require('./orders'));
router.use('/promotions',            require('./promotions'));
router.use('/shipping-rates',        require('./shippingRates'));
router.use('/financing-offers',      require('./financingOffers'));
router.use('/leads',                 require('./leadRouting'));
router.use('/crm',                   require('./crm'));

module.exports = router;
