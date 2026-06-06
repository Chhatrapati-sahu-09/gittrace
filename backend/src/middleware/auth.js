/**
 * GitTrace — Auth Middleware
 *
 * Validates that incoming requests are from the GitTrace extension.
 * Checks the X-GitTrace-Key header against our shared secret.
 *
 * In development: logs a warning but still allows requests through.
 * In production: blocks any request without the correct key.
 */

const config = require("../config");

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authMiddleware(req, res, next) {
  const incomingKey = req.headers["x-gittrace-key"];

  // Development mode: warn but allow through so testing is easy
  if (config.server.isDev) {
    if (!incomingKey) {
      console.warn("[Auth] No X-GitTrace-Key header — allowed in dev mode");
    } else if (incomingKey !== config.security.secret) {
      console.warn("[Auth] Wrong X-GitTrace-Key — allowed in dev mode");
    }
    return next();
  }

  // Production mode: strictly enforce
  if (!incomingKey) {
    return res.status(401).json({
      success: false,
      error: "Missing X-GitTrace-Key header",
    });
  }

  if (incomingKey !== config.security.secret) {
    return res.status(403).json({
      success: false,
      error: "Invalid X-GitTrace-Key",
    });
  }

  next();
}

module.exports = authMiddleware;
