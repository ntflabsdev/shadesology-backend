const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Category = require('../../models/Category');

const router = express.Router();
const ctrl = makeCrudController(Category, {
  searchFields: ['name.en', 'slug'],
  populateFields: ['parent', 'productTypes'],
  defaultSort: 'sortOrder',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
