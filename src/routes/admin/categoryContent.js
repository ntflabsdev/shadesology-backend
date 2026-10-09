const express = require('express');
const {
  adminGetContent,
  adminUpsertContent,
  adminSetCrawlableFilters,
} = require('../../controllers/catalog/categoryController');

const router = express.Router();

// GET    /admin/category-content/:categoryId         — get content for a category
// PUT    /admin/category-content/:categoryId         — upsert content
// PATCH  /admin/category-content/:categoryId/crawlable — set crawlable filter keys
router.get('/:categoryId',               adminGetContent);
router.put('/:categoryId',               adminUpsertContent);
router.patch('/:categoryId/crawlable',   adminSetCrawlableFilters);

module.exports = router;
