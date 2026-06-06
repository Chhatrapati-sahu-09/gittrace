/**
 * GitTrace Backend — Config
 *
 * Single place to read all environment variables.
 * Throws clear errors if required values are missing.
 * Import this file everywhere instead of using process.env directly.
 */

require("dotenv").config();

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Read a required env variable.
 * Throws an error with a clear message if it is missing.
 *
 * @param {string} key - The env variable name
 * @param {string} [fallback] - Optional default value
 * @returns {string}
 */
function required(key, fallback) {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(
      `[GitTrace Config] Missing required environment variable: ${key}\n` +
        `Add it to your backend/.env file.`,
    );
  }
  return value;
}

// ─── Config Object ────────────────────────────────────────────────────────────

const config = {
  // Server settings
  server: {
    port: parseInt(process.env.PORT || "3001", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    isDev: (process.env.NODE_ENV || "development") === "development",
  },

  // GitHub API
  github: {
    token: required("GITHUB_TOKEN"),
    apiBase: "https://api.github.com",
    // Max files to fetch content for (keep low to stay within rate limits)
    maxFilesToFetch: 10,
    // Only fetch files smaller than this (bytes) — skip huge generated files
    maxFileSizeBytes: 50000,
  },

  // Security
  security: {
    // Chrome extension sends this header to prove it is GitTrace
    // Checked in authMiddleware
    secret: process.env.GITTRACE_SECRET || "dev-secret-day3",
  },

  // AI Detection (Day 4)
  ai: {
    apiKey: process.env.AI_API_KEY || "",
    apiUrl: process.env.AI_API_URL || "",
  },

  // Rate limiting
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute window
    maxPerWindow: 30, // max 30 requests per IP per minute
  },

  // Cache TTL in seconds
  cache: {
    ttlSeconds: 10 * 60, // 10 minutes
  },
};

module.exports = config;
