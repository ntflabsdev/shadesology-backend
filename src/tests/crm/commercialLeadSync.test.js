'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../../models/Lead');
const hubspot = require('../../services/hubspot');
const { syncEntity } = require('../../workers/crmSyncWorker');

test('commercial leads sync with a commercial contact flag and deal pipeline', async () => {
  const original = {
    findById: Lead.findById,
    updateOne: Lead.updateOne,
    upsertContact: hubspot.upsertContact,
    upsertCompany: hubspot.upsertCompany,
    createDeal: hubspot.createDeal,
    apiRequest: hubspot.apiRequest,
    pipeline: process.env.HUBSPOT_COMMERCIAL_PIPELINE_ID,
    stage: process.env.HUBSPOT_COMMERCIAL_STAGE_ID,
  };
  const lead = {
    _id: 'commercial-lead-1',
    name: 'Project Lead',
    email: 'lead@example.test',
    company: 'Example Properties',
    enquiryType: 'commercial_project',
    leadQueue: 'commercial',
    productType: 'Pergolas',
    status: 'new',
  };
  let contact;
  let company;
  let deal;

  Lead.findById = () => ({ lean: async () => lead });
  Lead.updateOne = async () => ({ acknowledged: true });
  hubspot.upsertContact = async (value) => {
    contact = value;
    return { contactId: 'hs-contact-1' };
  };
  hubspot.upsertCompany = async (value) => {
    company = value;
    return { companyId: 'hs-company-1' };
  };
  hubspot.apiRequest = async () => ({});
  hubspot.createDeal = async (value) => {
    deal = value;
    return { dealId: 'hs-deal-1' };
  };
  process.env.HUBSPOT_COMMERCIAL_PIPELINE_ID = 'commercial-pipeline';
  process.env.HUBSPOT_COMMERCIAL_STAGE_ID = 'new-enquiry';

  try {
    const result = await syncEntity('lead', lead._id);
    assert.equal(contact.customProperties.shadesology_commercial_flag, 'true');
    assert.equal(contact.customProperties.shadesology_lead_queue, 'commercial');
    assert.equal(deal.pipeline, 'commercial-pipeline');
    assert.equal(deal.stage, 'new-enquiry');
    assert.equal(deal.dealType, 'commercial_lead');
    assert.equal(deal.contactId, 'hs-contact-1');
    assert.equal(deal.companyId, 'hs-company-1');
    assert.equal(company.name, lead.company);
    assert.deepEqual(result, { contactId: 'hs-contact-1', dealId: 'hs-deal-1' });
  } finally {
    Lead.findById = original.findById;
    Lead.updateOne = original.updateOne;
    hubspot.upsertContact = original.upsertContact;
    hubspot.upsertCompany = original.upsertCompany;
    hubspot.createDeal = original.createDeal;
    hubspot.apiRequest = original.apiRequest;
    if (original.pipeline === undefined) {
      delete process.env.HUBSPOT_COMMERCIAL_PIPELINE_ID;
    } else {
      process.env.HUBSPOT_COMMERCIAL_PIPELINE_ID = original.pipeline;
    }
    if (original.stage === undefined) {
      delete process.env.HUBSPOT_COMMERCIAL_STAGE_ID;
    } else {
      process.env.HUBSPOT_COMMERCIAL_STAGE_ID = original.stage;
    }
  }
});
