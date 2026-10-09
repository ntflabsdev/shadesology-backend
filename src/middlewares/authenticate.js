const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const { createError } = require('./errorHandler');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { getPayloadCookieName, resolvePayloadStaff } = require('../services/payloadIdentity');

/**
 * authenticate — verifyToken middleware.
 *
 * Reads the JWT from the HttpOnly cookie, verifies it, checks tokenVersion
 * (for immediate revocation), and attaches the full user to req.user.
 *
 * Routes that need auth: apply this middleware first, then requireRole.
 */
const authenticate = async (req, res, next) => {
  try {
    const payloadToken = req.cookies?.[getPayloadCookieName()];
    if (payloadToken) {
      const staff = await resolvePayloadStaff(payloadToken);
      if (!staff) {
        return next(createError(401, 'Invalid or expired Payload staff session.'));
      }
      req.user = staff;
      return next();
    }

    const token = req.cookies[COOKIE_NAME];

    if (!token) {
      return next(createError(401, 'Authentication required.'));
    }

    // Verify signature + expiry
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return next(createError(401, 'Invalid or expired session. Please log in again.'));
    }

    // Load user — include tokenVersion (excluded from default toJSON, select it explicitly)
    const user = await User.findById(payload.sub)
      .select('+tokenVersion')
      .lean();

    if (!user) {
      return next(createError(401, 'User no longer exists.'));
    }

    if (!user.isActive) {
      return next(createError(403, 'Your account has been suspended. Please contact support.'));
    }

    // Token version check — immediate revocation
    if (user.tokenVersion !== payload.tokenVersion) {
      return next(createError(401, 'Session has been revoked. Please log in again.'));
    }

    if (user.role === 'staff') {
      return next(createError(401, 'Staff must sign in through the Payload admin.'));
    }

    // Attach user to request (without sensitive fields)
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * optionalAuthenticate — attaches req.user if a valid token is present,
 * but does NOT block the request if there is no token.
 * Used for routes that behave differently for logged-in users (e.g. price visibility).
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const payloadToken = req.cookies?.[getPayloadCookieName()];
    if (payloadToken) {
      try {
        const staff = await resolvePayloadStaff(payloadToken);
        if (staff) {
          req.user = staff;
        }
      } catch (error) {
        return next(error);
      }
      return next();
    }

    const token = req.cookies[COOKIE_NAME];
    if (!token) {
      return next();
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return next(); // ignore invalid token for optional routes
    }

    const user = await User.findById(payload.sub)
      .select('+tokenVersion')
      .lean();

    if (user && user.isActive && user.tokenVersion === payload.tokenVersion) {
      req.user = user;
    }

    next();
  } catch {
    next();
  }
};

module.exports = { authenticate, optionalAuthenticate };
