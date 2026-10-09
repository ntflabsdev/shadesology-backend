'use strict';

require('dotenv').config();

const connectDB = require('../config/db');
const HomepageSection = require('../models/HomepageSection');
const NavMenu = require('../models/NavMenu');
const FooterConfig = require('../models/FooterConfig');
const {
  migrateLegacyHomepage,
  migrateLegacyNavigation,
  migrateLegacyFooter,
} = require('../services/payloadPublicContent');

const API_BASE = process.env.PAYLOAD_REST_URL;
const applyChanges = process.argv.includes('--apply');

async function payloadRequest(path, options = {}) {
  const response = await fetch(new URL(path, `${API_BASE.replace(/\/+$/, '')}/`), {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', ...options.headers },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Payload returned invalid JSON for ${path}.`);
  }
  if (!response.ok) {
    throw new Error(`Payload ${path} failed (${response.status}): ${body.errors?.[0]?.message || body.message || 'request failed'}`);
  }
  return { body, response };
}

function hasGlobalContent(slug, data) {
  if (slug === 'homepage') {
    return Boolean(data.sections?.length);
  }
  if (slug === 'navigation') {
    return Boolean(data.items?.length || data.mobileItems?.length);
  }
  return Boolean(
    data.linkGroups?.length ||
    data.socialLinks?.length ||
    data.legalLinks?.length ||
    data.phone ||
    data.email,
  );
}

async function importGlobal(slug, data, token) {
  const { body: current } = await payloadRequest(`globals/${slug}?locale=all&depth=0`, {
    headers: { Authorization: `JWT ${token}` },
  });
  if (hasGlobalContent(slug, current)) {
    console.log(`${slug}: skipped; target already contains content (no overwrite performed).`);
    return;
  }
  await payloadRequest(`globals/${slug}?locale=all&draft=false`, {
    method: 'POST',
    headers: {
      Authorization: `JWT ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  console.log(`${slug}: imported.`);
}

async function main() {
  if (!API_BASE) {
    throw new Error('PAYLOAD_REST_URL is required.');
  }
  await connectDB();

  const [homepageSections, mainMenu, mobileMenu, footer] = await Promise.all([
    HomepageSection.find().sort('sortOrder').lean(),
    NavMenu.findOne({ type: 'main', isActive: true }).lean(),
    NavMenu.findOne({ type: 'mobile', isActive: true }).lean(),
    FooterConfig.findOne().lean(),
  ]);

  const homepage = migrateLegacyHomepage(homepageSections);
  const navigation = migrateLegacyNavigation(mainMenu, mobileMenu);
  const footerData = migrateLegacyFooter(footer);
  const unsupported = homepage.unsupported;
  console.log(JSON.stringify({
    mode: applyChanges ? 'apply' : 'dry-run',
    sourceCounts: {
      homepageSections: homepageSections.length,
      mainNavigationItems: mainMenu?.items?.length || 0,
      mobileNavigationItems: mobileMenu?.items?.length || 0,
      footerLinkGroups: footer?.linkGroups?.length || 0,
    },
    payloadCounts: {
      homepageBlocks: homepage.data.sections.length,
      navigationItems: navigation.items.length,
      mobileNavigationItems: navigation.mobileItems.length,
      footerLinkGroups: footerData.linkGroups?.length || 0,
    },
    unsupportedHomepageSections: unsupported,
  }, null, 2));

  if (!applyChanges) {
    console.log('No data changed. Run with --apply after reviewing this report and configuring an admin account.');
    return;
  }
  if (unsupported.length) {
    throw new Error('Migration stopped: unsupported homepage section types need manual conversion before applying.');
  }
  if (!process.env.PAYLOAD_MIGRATION_EMAIL || !process.env.PAYLOAD_MIGRATION_PASSWORD) {
    throw new Error('PAYLOAD_MIGRATION_EMAIL and PAYLOAD_MIGRATION_PASSWORD are required with --apply.');
  }

  const { body: login } = await payloadRequest('users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.PAYLOAD_MIGRATION_EMAIL,
      password: process.env.PAYLOAD_MIGRATION_PASSWORD,
    }),
  });
  if (!login.token) {
    throw new Error('Payload login did not return an authentication token.');
  }

  await importGlobal('homepage', homepage.data, login.token);
  await importGlobal('navigation', navigation, login.token);
  await importGlobal('footer', footerData, login.token);
}

main()
  .catch((error) => {
    console.error(`Payload globals migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });
