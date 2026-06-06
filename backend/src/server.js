/**
 * GitTrace Backend — Express Server
 *
 * Entry point for the Node.js API.
 * Sets up all middleware and mounts all routes.
 *
 * Start with:
 *   npm run dev   (development — auto-restarts on file change)
 *   npm start     (production)
 */

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const authMiddleware = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");
const analyzeRoute = require("./routes/analyze");

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────

// Helmet adds security headers (XSS protection, no sniff, etc.)
app.use(helmet());

// CORS — allow requests from Chrome extensions and localhost
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow: no origin (curl, Postman), Chrome extensions, localhost
      if (
        !origin ||
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://127.0.0.1")
      ) {
        return callback(null, true);
      }
      callback(new Error(`CORS: Origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-GitTrace-Key"],
    credentials: false,
  }),
);

// Rate limiting — prevent API abuse
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests. Please wait 1 minute before retrying.",
  },
});
app.use("/api", limiter);

// ─── General Middleware ───────────────────────────────────────────────────────

// Parse JSON request bodies
app.use(express.json({ limit: "1mb" }));

// Request logging
// 'dev' format: GET /api/analyze 200 342ms
app.use(morgan("dev"));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Root health check — no auth needed
app.get("/", (req, res) => {
  res.json({
    name: "GitTrace API",
    version: "0.1.0",
    status: "running",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "GET  /health",
      analyze: "POST /api/analyze",
    },
  });
});

// Server-level health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage().heapUsed,
    timestamp: new Date().toISOString(),
  });
});

// Protected API routes — auth middleware checks X-GitTrace-Key
app.use("/api/analyze", authMiddleware, analyzeRoute);

// 404 handler — for any route we haven't defined
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
  });
});

// Global error handler — must be last
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(config.server.port, () => {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║       GitTrace Backend API           ║");
  console.log("╠══════════════════════════════════════╣");
  console.log(`║  Port    : ${config.server.port}                       ║`);
  console.log(`║  Mode    : ${config.server.nodeEnv}               ║`);
  console.log(
    `║  GitHub  : Token ${config.github.token ? "loaded ✓" : "MISSING ✗"}          ║`,
  );
  console.log("╠══════════════════════════════════════╣");
  console.log("║  Routes:                             ║");
  console.log("║    GET  /                            ║");
  console.log("║    GET  /health                      ║");
  console.log("║    POST /api/analyze                 ║");
  console.log("║    GET  /api/analyze/health          ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
});

module.exports = app;
