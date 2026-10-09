const express = require('express');
const {
  adminGetFooter,
  adminUpsertFooter,
  adminAddLinkGroup,
  adminUpdateLinkGroup,
  adminDeleteLinkGroup,
} = require('../../controllers/footer/footerController');

const router = express.Router();

router.get('/',                          adminGetFooter);
router.put('/',                          adminUpsertFooter);
router.post('/groups',                   adminAddLinkGroup);
router.put('/groups/:groupId',           adminUpdateLinkGroup);
router.delete('/groups/:groupId',        adminDeleteLinkGroup);

module.exports = router;
