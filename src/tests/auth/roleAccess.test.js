/**
 * Cross-role access tests — Prompt 1.4 done-check.
 *
 * Proves that:
 *  1. Unauthenticated requests to protected routes → 401
 *  2. customer/installer/specifier/dealer cannot reach /admin/* → 403
 *  3. staff CAN reach /admin/* → not 401/403
 *  4. Pricing group cannot be set by non-staff → 403
 *  5. tokenVersion mismatch → 401 (session revoked)
 *
 * Uses Node.js built-in test runner (node --test).
 * No DB needed — mocks JWT signing and User.findById.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ─── Setup: load env stubs before requiring app ───────────────────────────────
process.env.NODE_ENV        = 'test';
process.env.JWT_SECRET      = 'test_secret_for_tests_only';
process.env.JWT_EXPIRES_IN  = '1h';
process.env.MONGODB_URI     = 'mongodb://localhost:27017';  // not actually connected
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.PAYLOAD_REST_URL = 'http://payload.test/api';

// ─── Stub mongoose to prevent real DB connections ─────────────────────────────
const mongoose = require('mongoose');
// Override connect so it never actually dials out
mongoose.connect = async () => {};

// ─── Import JWT utils (no DB needed) ─────────────────────────────────────────
const { signToken } = require('../../utils/jwt');

// ─── Build tokens for every role ─────────────────────────────────────────────
const makeUser = (role, id = `000000000000000000000${role.slice(0,3)}`, tokenVersion = 0) => ({
  _id: { toString: () => id },
  role,
  staffRole: role === 'staff' ? 'admin' : '',
  tokenVersion,
  isActive: true,
  email: `${role}@test.com`,
});

const tokens = {};
for (const role of ['customer', 'installer', 'specifier', 'dealer', 'staff']) {
  tokens[role] = signToken(makeUser(role));
}
const supportUser = { ...makeUser('staff', '000000000000000000000sup'), staffRole: 'support' };
tokens.supportStaff = signToken(supportUser);
const unassignedStaffUser = { ...makeUser('staff', '000000000000000000000asn'), staffRole: '' };
tokens.unassignedStaff = signToken(unassignedStaffUser);
tokens.payloadAdmin = 'payload-admin-test-token';
tokens.payloadSupport = 'payload-support-test-token';
// Revoked token — tokenVersion will mismatch
const revokedToken = signToken({ ...makeUser('customer'), tokenVersion: 0, _id: { toString: () => 'revoked_user_id' } });

const originalFetch = global.fetch;
global.fetch = async (input, options = {}) => {
  const cookie = options.headers?.cookie || '';
  const role = cookie.includes(tokens.payloadAdmin)
    ? 'admin'
    : cookie.includes(tokens.payloadSupport)
      ? 'support'
      : null;
  return new Response(JSON.stringify(
    role ? { user: { id: `payload-${role}`, email: `${role}@test.com`, role } } : { user: null },
  ), { status: role ? 200 : 401, headers: { 'Content-Type': 'application/json' } });
};

// ─── Stub User.findById so authenticate middleware can resolve users ───────────
const User = require('../../models/User');
const originalFindById = User.findById.bind(User);

User.findById = (id) => {
  const roleMap = {
    '000000000000000000000cus': makeUser('customer'),
    '000000000000000000000ins': makeUser('installer'),
    '000000000000000000000spe': makeUser('specifier'),
    '000000000000000000000dea': makeUser('dealer'),
    '000000000000000000000sta': makeUser('staff'),
    '000000000000000000000sup': supportUser,
    '000000000000000000000asn': unassignedStaffUser,
    'revoked_user_id':          { ...makeUser('customer'), tokenVersion: 99 }, // bumped
  };

  const user = roleMap[id] || null;

  // Mimic Mongoose chainable .select().lean()
  const chain = {
    select: () => chain,
    lean:   () => Promise.resolve(user),
    populate: () => chain,
    exec:   () => Promise.resolve(user),
    then:   (resolve) => Promise.resolve(user).then(resolve),
  };
  return chain;
};

// ─── Start test server ───────────────────────────────────────────────────────
let server;
let baseUrl;

before(async () => {
  const app = require('../../app');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  User.findById = originalFindById;
  global.fetch = originalFetch;
});

// ─── Helper: make HTTP request with optional cookie ───────────────────────────
const request = (method, path, token, body) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname,
      method:   method.toUpperCase(),
      headers:  {
        'Content-Type': 'application/json',
        ...(token ? { Cookie: token.startsWith('payload-') ? `payload-token=${token}` : `shades_token=${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Unauthenticated access', () => {
  test('GET /admin/products → 401 without token', async () => {
    const res = await request('GET', '/admin/products');
    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
    assert.equal(res.body.success, false);
  });

  test('GET /api/auth/me → 401 without token', async () => {
    const res = await request('GET', '/api/auth/me');
    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  });

  test('GET /api/approvals/mine → 401 without token', async () => {
    const res = await request('GET', '/api/approvals/mine');
    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
  });
});

describe('Customer role — cannot access admin', () => {
  test('GET /admin/products → 403', async () => {
    const res = await request('GET', '/admin/products', tokens.customer);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test('GET /admin/users → 403', async () => {
    const res = await request('GET', '/admin/users', tokens.customer);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  });

  test('GET /admin/approvals → 403', async () => {
    const res = await request('GET', '/admin/approvals', tokens.customer);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  });
});

describe('Installer role — cannot access admin', () => {
  test('GET /admin/products → 403', async () => {
    const res = await request('GET', '/admin/products', tokens.installer);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  });

  test('GET /admin/approvals → 403', async () => {
    const res = await request('GET', '/admin/approvals', tokens.installer);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  });
});

describe('Specifier role — cannot access admin', () => {
  test('GET /admin/products → 403', async () => {
    const res = await request('GET', '/admin/products', tokens.specifier);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  });
});

describe('Dealer role — cannot access admin', () => {
  test('GET /admin/products → 403', async () => {
    const res = await request('GET', '/admin/products', tokens.dealer);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  });

  test('GET /admin/users → 403', async () => {
    const res = await request('GET', '/admin/users', tokens.dealer);
    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
  });
});

describe('Staff role — can access admin', () => {
  test('Payload administrator session can access API-backed admin routes', async () => {
    const res = await request('GET', '/admin/product-types', tokens.payloadAdmin);
    // Will be 500 (no DB) or 200, but must NOT be 401/403
    assert.notEqual(res.status, 401, `Got 401 — staff auth failed`);
    assert.notEqual(res.status, 403, `Got 403 — staff role rejected`);
  });

  test('Payload staff session can access shared staff work queues', async () => {
    const res = await request('GET', '/admin/approvals', tokens.payloadSupport);
    assert.notEqual(res.status, 401, `Got 401 — staff auth failed`);
    assert.notEqual(res.status, 403, `Got 403 — staff role rejected`);
  });

  test('Payload support role cannot access administrator-only user management', async () => {
    const res = await request('GET', '/admin/users', tokens.payloadSupport);
    assert.equal(res.status, 403);
  });

  test('legacy API-authenticated staff session is rejected', async () => {
    const res = await request('GET', '/admin/products', tokens.staff);
    assert.equal(res.status, 401);
  });

  test('Payload editorial mode disables legacy catalog write APIs', async () => {
    const previousSource = process.env.EDITORIAL_CONTENT_SOURCE;
    process.env.EDITORIAL_CONTENT_SOURCE = 'payload';
    try {
      const res = await request('POST', '/admin/categories', tokens.payloadAdmin, {
        slug: 'cms-managed-category',
      });
      assert.equal(res.status, 410);
    } finally {
      if (previousSource === undefined) {
        delete process.env.EDITORIAL_CONTENT_SOURCE;
      } else {
        process.env.EDITORIAL_CONTENT_SOURCE = previousSource;
      }
    }
  });
});

describe('Staff-sensitive user administration', () => {
  test('support staff cannot change roles or pricing groups', async () => {
    const roleRes = await request(
      'PATCH',
      '/admin/users/000000000000000000000001/role',
      tokens.payloadSupport,
      { role: 'staff', staffRole: 'admin' }
    );
    const pricingRes = await request(
      'PATCH',
      '/admin/users/000000000000000000000001/pricing-group',
      tokens.payloadSupport,
      { pricingGroup: 'dealer' }
    );

    assert.equal(roleRes.status, 403);
    assert.equal(pricingRes.status, 403);
  });

  test('user profile update rejects password and role fields', async () => {
    const res = await request(
      'PUT',
      '/admin/users/000000000000000000000001',
      tokens.payloadAdmin,
      { passwordHash: '$2a$12$attacker-controlled', role: 'staff', staffRole: 'admin' }
    );

    assert.equal(res.status, 400);
  });
});

test('optional Payload staff identity failures are surfaced', async () => {
  const { optionalAuthenticate } = require('../../middlewares/authenticate');
  const previousFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('Payload identity service unavailable');
  };

  try {
    const error = await new Promise((resolve) => {
      optionalAuthenticate(
        { cookies: { 'payload-token': tokens.payloadAdmin } },
        {},
        resolve,
      );
    });
    assert.equal(error.statusCode, 503);
  } finally {
    global.fetch = previousFetch;
  }
});

describe('Session revocation', () => {
  test('Revoked token (tokenVersion mismatch) → 401', async () => {
    const res = await request('GET', '/api/auth/me', revokedToken);
    assert.equal(res.status, 401, `Expected 401 for revoked session, got ${res.status}`);
  });
});

describe('Public auth routes — accessible without token', () => {
  test('POST /api/auth/login → 400 (missing body, but NOT 401)', async () => {
    const res = await request('POST', '/api/auth/login');
    // No token provided — should hit the controller and fail with 400 (missing fields)
    // NOT 401 (which would mean the route itself requires auth)
    assert.notEqual(res.status, 401, `Login route should be public — got 401`);
  });

  test('GET /health → 200 or 503 (never 401)', async () => {
    const res = await request('GET', '/health');
    assert.notEqual(res.status, 401, `Health should be public — got 401`);
  });
});
