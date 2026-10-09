const { createPayloadContentClient } = require('../services/payloadContent');

const getCollection = async (req, res, next) => {
  try {
    const client = createPayloadContentClient();
    const data = await client.findPublished(req.params.slug, req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getGlobal = async (req, res, next) => {
  try {
    const client = createPayloadContentClient();
    const data = await client.findPublishedGlobal(req.params.slug, req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = { getCollection, getGlobal };
