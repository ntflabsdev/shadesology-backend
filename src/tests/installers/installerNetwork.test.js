'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Installer = require('../../models/Installer');
const InstallerLead = require('../../models/InstallerLead');
const InstallerReferralConfig = require('../../models/InstallerReferralConfig');
const {
  normalizePostcode,
  distanceMiles,
  nearestCoverage,
} = require('../../services/installerNetwork');
const { portalLeads, respondToLead } = require('../../controllers/installer/installerController');
const { checkInstallerCertification } = require('../../controllers/download/downloadController');

describe('Installer network and portal access', () => {
  it('normalizes postcodes and calculates coverage-radius overlap', () => {
    assert.equal(normalizePostcode('ab1 2cd'), 'AB12CD');
    assert.ok(Math.abs(distanceMiles(0, 0, 0, 1) - 69.1) < 1);
    const coverage = nearestCoverage({
      coverageAreas: [{ lat: 40.7, lng: -74, radiusMiles: 25 }],
    }, { lat: 40.8, lng: -74 });
    assert.equal(coverage.covered, true);
    assert.ok(coverage.distance < 25);
  });

  it('validates installer lead and referral configuration records', async () => {
    await new Installer({
      businessName: 'North Star Installations',
      address: { city: 'Miami', state: 'FL' },
      status: 'approved',
      privateDocuments: [{ key: 'development/installer-applications/user/doc.pdf' }],
    }).validate();
    await new InstallerLead({
      lead: '507f1f77bcf86cd799439011',
      installer: '507f1f77bcf86cd799439012',
      status: 'offered',
    }).validate();
    await new InstallerReferralConfig({
      region: 'FL',
      enabled: true,
      partnerName: 'Regional Partner',
      partnerUrl: 'https://partner.example',
    }).validate();
    await assert.rejects(new Installer({
      businessName: 'Invalid Coverage',
      address: { city: 'Miami', state: 'FL' },
      coverageAreas: [{ postcode: '33101', radiusMiles: 0 }],
    }).validate(), (error) => Boolean(error.errors?.['coverageAreas.0.radiusMiles']));
  });

  it('requires a product certification for installer-only documents across download routes', async () => {
    const originalFindOne = Installer.findOne;
    let observed;
    try {
      const document = {
        audienceTags: ['installer'],
        requiredRole: 'installer',
        productTypes: ['product-type-A'],
      };
      assert.equal(await checkInstallerCertification(document, null), false);
      Installer.findOne = (filter) => {
        observed = filter;
        return { select: () => ({ lean: async () => ({ _id: 'installer-A' }) }) };
      };
      assert.equal(await checkInstallerCertification(document, { _id: 'user-A', role: 'installer' }), true);
      assert.equal(observed.user, 'user-A');
      assert.deepEqual(observed.certifiedProductTypes, { $in: ['product-type-A'] });
    } finally {
      Installer.findOne = originalFindOne;
    }
  });

  it('scopes both lead listing and accept/decline lookups to the signed-in installer', async () => {
    const originals = {
      findOne: Installer.findOne,
      find: InstallerLead.find,
      findOneAndUpdate: InstallerLead.findOneAndUpdate,
    };
    const observed = [];
    try {
      Installer.findOne = (filter) => ({
        lean: async () => ({ _id: `installer-${filter.user}`, status: 'approved', isActive: true }),
      });
      InstallerLead.find = (filter) => {
        observed.push(filter);
        return {
          sort() { return this; },
          limit() { return this; },
          populate() { return this; },
          lean: async () => [{
            _id: 'assignment-A',
            status: 'offered',
            lead: {
              name: 'Private Customer',
              email: 'private@example.com',
              phone: '5551234567',
              message: 'Call me at private@example.com or 5551234567',
              region: '123 Main St, Miami, FL 33101',
              orderNumber: 'ORDER-ABC',
              applicationData: { city: 'Miami', state: 'FL', address: '123 Main St' },
            },
          }],
        };
      };
      InstallerLead.findOneAndUpdate = (filter) => {
        observed.push(filter);
        return { populate: async () => null };
      };

      const responseA = { json(value) { this.body = value; } };
      const responseB = { json(value) { this.body = value; } };
      const next = (error) => {
        if (error) {throw error;}
      };
      await portalLeads({ user: { _id: 'user-A' } }, responseA, next);
      await portalLeads({ user: { _id: 'user-B' } }, responseB, next);
      assert.equal(observed[0].installer, 'installer-user-A');
      assert.equal(observed[1].installer, 'installer-user-B');
      assert.equal('name' in responseA.body.data[0].lead, false);
      assert.equal('email' in responseA.body.data[0].lead, false);
      assert.equal('phone' in responseA.body.data[0].lead, false);
      assert.equal('orderNumber' in responseA.body.data[0].lead, false);
      assert.equal('applicationData' in responseA.body.data[0].lead, false);
      assert.equal(responseA.body.data[0].lead.region, 'Miami, FL');
      assert.equal(responseA.body.data[0].lead.message.includes('private@example.com'), false);
      assert.equal(responseA.body.data[0].lead.message.includes('5551234567'), false);

      let routeError;
      await respondToLead(
        { user: { _id: 'user-B' }, params: { id: 'assignment-A', action: 'accept' } },
        responseB,
        (error) => { routeError = error; },
      );
      assert.equal(routeError.statusCode, 404);
      assert.equal(observed[2].installer, 'installer-user-B');
      assert.equal(observed[2]._id, 'assignment-A');
    } finally {
      Installer.findOne = originals.findOne;
      InstallerLead.find = originals.find;
      InstallerLead.findOneAndUpdate = originals.findOneAndUpdate;
    }
  });
});
