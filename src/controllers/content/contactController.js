'use strict';

// Kept as a compatibility export for any older route modules.
const { submitLead } = require('./leadController');
module.exports = { submitContact: submitLead };
