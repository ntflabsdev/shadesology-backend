const { createError } = require('./errorHandler');

/**
 * requireRole — role guard middleware factory.
 *
 * Must be used AFTER the authenticate middleware, which populates req.user
 * from the verified JWT.
 *
 * Usage:
 *   router.get('/admin-only', authenticate, requireRole('staff'), handler)
 *   router.get('/dealers',    authenticate, requireRole('dealer', 'staff'), handler)
 *   router.get('/trade',      authenticate, requireRole(['dealer','installer','specifier']), handler)
 */
const requireRole = (...allowedRoles) => {
  // Flatten so both requireRole('staff') and requireRole(['staff','dealer']) work
  const roles = allowedRoles.flat();

  return (req, res, next) => {
    // authenticate middleware must have run first
    if (!req.user) {
      return next(createError(401, 'Authentication required.'));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        createError(403, `Access denied. Required role: ${roles.join(' or ')}.`)
      );
    }

    next();
  };
};

const requireStaffRole = (...allowedStaffRoles) => {
  const roles = allowedStaffRoles.flat();

  return (req, res, next) => {
    if (!req.user || req.user.role !== 'staff') {
      return next(createError(403, 'Staff access required.'));
    }

    if (!roles.includes(req.user.staffRole)) {
      return next(createError(403, `Access denied. Required staff role: ${roles.join(' or ')}.`));
    }

    next();
  };
};

/**
 * requireStaff — shorthand for requireRole('staff').
 * Used on all /admin routes.
 *
 * NOTE: The admin router (routes/admin/index.js) applies requireStaff AFTER
 * the authenticate middleware is run per-request via the /admin mount.
 * The authenticate middleware is NOT applied inside admin/index.js itself —
 * it is applied in app.js before the admin router via a pre-middleware or
 * can be added here per-route. For the admin shell we add authenticate
 * as a first-layer guard below.
 */
const requireStaff = [
  // Inline authenticate so admin routes don't need separate middleware chain
  require('./authenticate').authenticate,
  requireRole('staff'),
  requireStaffRole(['admin', 'sales', 'support', 'content']),
];

module.exports = { requireRole, requireStaff, requireStaffRole };
