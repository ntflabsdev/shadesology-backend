const express = require('express');
const { optionalAuthenticate } = require('../middlewares/authenticate');
const {
  listCategories,
  getCategoryPage,
} = require('../controllers/catalog/categoryController');

const router = express.Router();

// GET /api/categories              — list all active categories (for menus etc.)
// GET /api/categories/:slug        — full category page: products + facets + SEO
router.get('/',       listCategories);
router.get('/:slug',  optionalAuthenticate, getCategoryPage);

module.exports = router;
