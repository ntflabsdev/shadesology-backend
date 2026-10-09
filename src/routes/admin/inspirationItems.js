const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const InspirationItem = require('../../models/InspirationItem');

const router = express.Router();
const ctrl = makeCrudController(InspirationItem, {
  searchFields: ['title.en', 'slug', 'style', 'setting', 'color'],
  populateFields: ['productType', 'manufacturer', 'products', 'project'],
  defaultSort: '-isFeatured sortOrder createdAt',
});

router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.patch('/:id/toggle', ctrl.toggleActive);
router.delete('/:id', ctrl.remove);

module.exports = router;
