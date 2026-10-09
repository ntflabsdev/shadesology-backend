const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Document = require('../../models/Document');

const router = express.Router();
const ctrl = makeCrudController(Document, {
  searchFields: ['title.en'],
  populateFields: ['products', 'productTypes', 'manufacturers'],
  defaultSort: '-createdAt',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
