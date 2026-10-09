const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const ProductType = require('../../models/ProductType');

const router = express.Router();
const ctrl = makeCrudController(ProductType, {
  searchFields: ['name.en', 'code', 'slug'],
  defaultSort: 'sortOrder',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
