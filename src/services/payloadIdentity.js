const { createError } = require('../middlewares/errorHandler');

const STAFF_ROLES = new Set(['admin', 'sales', 'support', 'content']);

function getPayloadCookieName() {
  return process.env.PAYLOAD_COOKIE_NAME || 'payload-token';
}

async function resolvePayloadStaff(cookieToken) {
  if (!cookieToken) {
    return null;
  }

  const restUrl = process.env.PAYLOAD_REST_URL;
  if (!restUrl) {
    throw createError(503, 'Payload staff identity verification is not configured.');
  }

  const endpoint = new URL('users/me', `${restUrl.replace(/\/+$/, '')}/`);
  if (
    process.env.NODE_ENV === 'production' &&
    endpoint.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(endpoint.hostname)
  ) {
    throw createError(500, 'PAYLOAD_REST_URL must use HTTPS in production.');
  }

  let response;
  try {
    response = await fetch(endpoint, {
      headers: { cookie: `${getPayloadCookieName()}=${encodeURIComponent(cookieToken)}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
  } catch (error) {
    const unavailable = createError(503, 'Payload identity service is unavailable.');
    unavailable.cause = error;
    throw unavailable;
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw createError(502, `Payload identity verification failed with status ${response.status}.`);
  }

  const body = await response.json();
  const user = body.user;
  if (!user || !STAFF_ROLES.has(user.role)) {
    return null;
  }

  return {
    _id: String(user.id),
    email: user.email,
    role: 'staff',
    staffRole: user.role,
    payloadUserId: String(user.id),
    isActive: true,
  };
}

module.exports = { getPayloadCookieName, resolvePayloadStaff };
