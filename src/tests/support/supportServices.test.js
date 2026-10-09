'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../../models/Lead');
const WarrantyRegistration = require('../../models/WarrantyRegistration');
const { getBusinessHoursStatus } = require('../../services/chat');
const { selectLeadRule } = require('../../services/leadRouting');
const { persistBeforeNotify } = require('../../services/leadSubmission');

describe('Support and lead services', () => {
  it('routes to the most specific matching lead rule', () => {
    const rules = [
      { enquiryType: '', productType: '', region: '', notifyEmail: 'general@example.com' },
      { enquiryType: 'service_request', productType: '', region: '', notifyEmail: 'service@example.com' },
      { enquiryType: 'service_request', productType: 'awning', region: 'CA', notifyEmail: 'west-awning@example.com' },
      { enquiryType: 'service_request', productType: 'awning', region: '', notifyEmail: 'awning@example.com' },
    ];
    assert.equal(selectLeadRule(rules, {
      enquiryType: 'service_request', productType: 'awning', region: 'ca',
    }).notifyEmail, 'west-awning@example.com');
    assert.equal(selectLeadRule(rules, {
      enquiryType: 'contact', productType: '', region: '',
    }).notifyEmail, 'general@example.com');
  });

  it('routes chat messages by configured business hours and timezone', () => {
    const oldTimezone = process.env.CHAT_BUSINESS_TIMEZONE;
    process.env.CHAT_BUSINESS_TIMEZONE = 'America/New_York';
    try {
      const weekday = getBusinessHoursStatus(new Date('2026-10-08T14:00:00Z'));
      const evening = getBusinessHoursStatus(new Date('2026-10-08T23:00:00Z'));
      assert.equal(weekday.online, true);
      assert.equal(weekday.routing, 'business_hours');
      assert.equal(evening.online, false);
      assert.equal(evening.routing, 'offline_message');
    } finally {
      if (oldTimezone === undefined) {delete process.env.CHAT_BUSINESS_TIMEZONE;}
      else {process.env.CHAT_BUSINESS_TIMEZONE = oldTimezone;}
    }
  });

  it('validates persistent lead and warranty record shapes before any database write', async () => {
    await new Lead({
      enquiryType: 'contact', name: 'Ada Customer', email: 'ada@example.com',
      message: 'Please help with my awning order.',
    }).validate();
    await assert.rejects(new Lead({
      enquiryType: 'not-a-lead-type', name: 'Ada', email: 'ada@example.com', message: 'Long enough.',
    }).validate(), (error) => Boolean(error.errors?.enquiryType));
    await new WarrantyRegistration({
      name: 'Ada Customer', email: 'ada@example.com', model: 'Series A', productType: 'awning', installDate: new Date(),
    }).validate();
  });

  it('persists a lead before notification and resolves successfully when mail queuing fails', async () => {
    const calls = [];
    const record = { id: 'lead-record' };
    const result = await persistBeforeNotify(
      async () => { calls.push('persist'); return record; },
      async () => { calls.push('notify'); throw new Error('mail queue unavailable'); }
    );
    assert.equal(result, record);
    assert.deepEqual(calls, ['persist', 'notify']);
  });
});
