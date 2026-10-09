const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Variant = require('../../models/Variant');

const router = express.Router();
const ctrl = makeCrudController(Variant, {
  searchFields: ['name.en', 'sku'],
  populateFields: ['product', 'allowedOptionGroups'],
  defaultSort: 'sortOrder',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
