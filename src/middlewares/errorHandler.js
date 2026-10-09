/**
 * Central error handling middleware.
 * Must be registered LAST in app.js (after all routes).
 *
 * Normalises errors into a consistent JSON shape:
 *   { success: false, message: string, stack?: string }
 */
const errorHandler = (err, req, res, next) => {
  // Respect status code already set on the error object, default to 500
  const statusCode = err.statusCode || err.status || 500;

  // Mongoose validation errors → 400
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: messages.join(', '),
    });
  }

  // Mongoose duplicate key → 409
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `Duplicate value for ${field}.`,
    });
  }

  // Mongoose bad ObjectId → 400
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid value for ${err.path}: ${err.value}`,
    });
  }

  // JWT errors → 401
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }

  const response = {
    success: false,
    message: err.message || 'Internal Server Error',
  };

  // Only expose stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

/**
 * Helper to create an error with a status code.
 * Usage: throw createError(404, 'Product not found')
 */
const createError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

module.exports = { errorHandler, createError };
