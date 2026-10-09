const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Fabric = require('../../models/Fabric');

const router = express.Router();
const ctrl = makeCrudController(Fabric, {
  searchFields: ['name.en', 'sku', 'brand', 'subRange'],
  populateFields: ['compatibleProductTypes'],
  defaultSort: 'brand name.en',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
