const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Cookie name used everywhere — change once here if needed
const COOKIE_NAME = 'shades_token';

// Cookie max-age in ms (must match JWT expiry)
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Sign a JWT containing user identity + tokenVersion.
 * tokenVersion allows immediate revocation of all sessions.
 */
const signToken = (user) => {
  return jwt.sign(
    {
      sub:          user._id.toString(),
      role:         user.role,
      tokenVersion: user.tokenVersion,
    },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
};

/**
 * Verify a JWT and return the decoded payload.
 * Throws JsonWebTokenError / TokenExpiredError on failure.
 */
const verifyToken = (token) => {
  return jwt.verify(token, SECRET);
};

/**
 * Attach the auth cookie to a response.
 * HttpOnly + Secure (in production) + SameSite=Strict.
 */
const setAuthCookie = (res, token) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
  });
};

/**
 * Clear the auth cookie.
 */
const clearAuthCookie = (res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
};

module.exports = { signToken, verifyToken, setAuthCookie, clearAuthCookie, COOKIE_NAME };
