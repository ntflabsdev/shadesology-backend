const express = require('express');
const {
  adminGetSections,
  createSection,
  updateSection,
  toggleSection,
  reorderSections,
  deleteSection,
} = require('../../controllers/homepage/homepageController');

const router = express.Router();

// All routes protected by requireStaff (applied in admin/index.js)

router.get('/',                  adminGetSections);   // list all (incl. inactive)
router.post('/',                 createSection);      // create new section
router.put('/:id',               updateSection);      // full update
router.patch('/:id/toggle',      toggleSection);      // toggle isActive
router.patch('/reorder',         reorderSections);    // bulk sortOrder update
router.delete('/:id',            deleteSection);      // delete section

module.exports = router;
