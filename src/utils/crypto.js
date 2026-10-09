const crypto = require('crypto');

/**
 * Generate a cryptographically secure random token.
 * Used for email verification and password reset tokens.
 * Returns a hex string of the requested byte length (default 32 bytes = 64 hex chars).
 */
const generateToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/**
 * Hash a token for safe storage in the database.
 * We store the hash, not the raw token — avoids DB leak exposing reset links.
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = { generateToken, hashToken };
