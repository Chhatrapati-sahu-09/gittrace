/**
 * GitTrace — Global Error Handler Middleware
 *
 * Catches any error thrown inside route handlers.
 * Returns a clean JSON error response instead of crashing.
 *
 * Must be registered AFTER all routes in server.js.
 */

/**
 * @param {Error} err
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
  // Log the full error for debugging
  console.error("[Error Handler]", err.message);
  if (process.env.NODE_ENV === "development") {
    console.error(err.stack);
  }

  // Determine HTTP status code
  let statusCode = err.statusCode || 500;

  // Map common error messages to status codes
  if (err.message.includes("not found")) statusCode = 404;
  if (err.message.includes("rate limit")) statusCode = 429;
  if (err.message.includes("authentication")) statusCode = 401;
  if (err.message.includes("timed out")) statusCode = 504;

  res.status(statusCode).json({
    success: false,
    error: err.message,
    timestamp: new Date().toISOString(),
    path: req.path,
  });
}

module.exports = errorHandler;
