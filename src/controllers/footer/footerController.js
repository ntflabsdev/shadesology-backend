const FooterConfig = require('../../models/FooterConfig');
const { createError } = require('../../middlewares/errorHandler');
const {
  isPayloadEditorialSource,
  getGlobal,
  mapFooter,
} = require('../../services/payloadPublicContent');

// ─── Public: get footer config ────────────────────────────────────────────────
const getFooter = async (req, res, next) => {
  try {
    if (isPayloadEditorialSource()) {
      return res.json({
        success: true,
        data: mapFooter(await getGlobal('footer', (global) => global)),
      });
    }

    const footer = await FooterConfig.findOne().lean();
    if (!footer) {
      return res.json({ success: true, data: { linkGroups: [], socialLinks: [], instagramFeed: [], newsletterEnabled: false } });
    }

    // Only return active link groups and social links
    const data = {
      ...footer,
      linkGroups:  (footer.linkGroups || []).filter((g) => g.isActive),
      socialLinks: (footer.socialLinks || []).filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
      instagramFeed: (footer.instagramFeed || []).filter((item) => item.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    };

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: get full footer config ───────────────────────────────────────────
const adminGetFooter = async (req, res, next) => {
  try {
    const footer = await FooterConfig.findOne().lean();
    res.json({ success: true, data: footer || {} });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: upsert footer config (singleton) ──────────────────────────────────
const adminUpsertFooter = async (req, res, next) => {
  try {
    let footer = await FooterConfig.findOne();
    if (footer) {
      Object.assign(footer, req.body);
      await footer.save();
    } else {
      footer = await FooterConfig.create(req.body);
    }
    res.json({ success: true, data: footer });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: add a link group ──────────────────────────────────────────────────
const adminAddLinkGroup = async (req, res, next) => {
  try {
    const footer = await FooterConfig.findOne();
    if (!footer) return next(createError(404, 'Footer config not found. Create it first.'));

    footer.linkGroups.push(req.body);
    await footer.save();

    res.status(201).json({ success: true, data: footer.linkGroups });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: update a link group ───────────────────────────────────────────────
const adminUpdateLinkGroup = async (req, res, next) => {
  try {
    const footer = await FooterConfig.findOne();
    if (!footer) return next(createError(404, 'Footer config not found.'));

    const group = footer.linkGroups.id(req.params.groupId);
    if (!group) return next(createError(404, 'Link group not found.'));

    Object.assign(group, req.body);
    await footer.save();

    res.json({ success: true, data: footer.linkGroups });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: delete a link group ───────────────────────────────────────────────
const adminDeleteLinkGroup = async (req, res, next) => {
  try {
    const footer = await FooterConfig.findOne();
    if (!footer) return next(createError(404, 'Footer config not found.'));

    const group = footer.linkGroups.id(req.params.groupId);
    if (!group) return next(createError(404, 'Link group not found.'));

    group.deleteOne();
    await footer.save();

    res.json({ success: true, message: 'Link group deleted.', data: footer.linkGroups });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getFooter,
  adminGetFooter,
  adminUpsertFooter,
  adminAddLinkGroup,
  adminUpdateLinkGroup,
  adminDeleteLinkGroup,
};
