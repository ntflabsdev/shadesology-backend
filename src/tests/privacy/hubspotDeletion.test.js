'use strict';

const { after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deleteContactByEmail } = require('../../services/hubspot');

const previousSandboxToken = process.env.HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN;
const previousSandboxPortal = process.env.HUBSPOT_SANDBOX_PORTAL_ID;
process.env.HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN = 'test-private-app-token';
process.env.HUBSPOT_SANDBOX_PORTAL_ID = '12345';

after(() => {
  if (previousSandboxToken === undefined) {delete process.env.HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN;}
  else {process.env.HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN = previousSandboxToken;}
  if (previousSandboxPortal === undefined) {delete process.env.HUBSPOT_SANDBOX_PORTAL_ID;}
  else {process.env.HUBSPOT_SANDBOX_PORTAL_ID = previousSandboxPortal;}
});

describe('HubSpot privacy deletion', () => {
  it('GDPR-deletes each exact email match and treats no matches as complete', async () => {
    const calls = [];
    const client = {
      async apiRequest(request) {
        calls.push(request);
        if (calls.length === 1) {
          return { json: async () => ({ results: [{ id: '1' }, { id: '2' }] }) };
        }
        return { ok: true, status: 204 };
      },
    };

    const result = await deleteContactByEmail('person@example.com', client);
    assert.deepEqual(result, { deleted: 2 });
    assert.equal(calls[0].path, '/crm/v3/objects/contacts/search');
    assert.equal(calls[0].body.filterGroups[0].filters[0].value, 'person@example.com');
    assert.match(calls[1].path, /contacts\/1\/gdpr-delete/);
    assert.match(calls[2].path, /contacts\/2\/gdpr-delete/);

    const noMatchClient = {
      async apiRequest() { return { json: async () => ({ results: [] }) }; },
    };
    assert.deepEqual(await deleteContactByEmail('missing@example.com', noMatchClient), { deleted: 0 });
  });

  it('fails the queue attempt when HubSpot rejects a GDPR deletion', async () => {
    let requests = 0;
    const client = {
      async apiRequest() {
        requests += 1;
        if (requests === 1) {return { json: async () => ({ results: [{ id: '123' }] }) };}
        return { ok: false, status: 403 };
      },
    };
    await assert.rejects(
      deleteContactByEmail('person@example.com', client),
      /HubSpot GDPR delete failed with status 403/,
    );
  });
});
