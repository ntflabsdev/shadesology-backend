/**
 * Request logging middleware.
 * Logs method, URL, status code, and response time for every request.
 * Uses colours in development for quick scanning.
 */

const colours = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

const getStatusColour = (status) => {
  if (status >= 500) {
    return colours.red;
  }
  if (status >= 400) {
    return colours.yellow;
  }
  if (status >= 300) {
    return colours.cyan;
  }
  return colours.green;
};

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      const statusColour = getStatusColour(status);
      console.log(
        `${colours.dim}${new Date().toISOString()}${colours.reset} ` +
          `${colours.cyan}${req.method}${colours.reset} ` +
          `${req.originalUrl} ` +
          `${statusColour}${status}${colours.reset} ` +
          `${colours.dim}${duration}ms${colours.reset}`
      );
    } else {
      // Production: structured log (works well with log aggregators)
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          method: req.method,
          url: req.originalUrl,
          status,
          duration_ms: duration,
          ip: req.ip,
        })
      );
    }
  });

  next();
};

module.exports = requestLogger;
