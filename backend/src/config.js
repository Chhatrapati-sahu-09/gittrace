/**
 * GitTrace Backend — Config
 *
 * Single source of truth for all environment variables.
 * Import this file everywhere instead of using process.env directly.
 */

require("dotenv").config();

// ─── Helper ───────────────────────────────────────────────────────────────────

function required(key, fallback) {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(
      `[Config] Missing required env variable: ${key}\n` +
        `Add it to backend/.env file.`,
    );
  }
  return value;
}

// ─── Config Object ────────────────────────────────────────────────────────────

const config = {
  server: {
    port: parseInt(process.env.PORT || "3001", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    isDev: (process.env.NODE_ENV || "development") === "development",
  },

  github: {
    token: required("GITHUB_TOKEN"),
    apiBase: "https://api.github.com",
    maxFilesToFetch: 10,
    maxFileSizeBytes: 50000,
  },

  security: {
    secret: process.env.GITTRACE_SECRET || "dev-secret-day3",
  },

  // AI Detection — NEW in Day 4
  ai: {
    apiKey: required("AI_API_KEY", "demo-mode"),
    apiUrl: process.env.AI_API_URL || "https://api.sapling.ai/api/v1/aidetect",
    demoMode: process.env.AI_DEMO_MODE === "true",
    // Thresholds for labeling scores
    thresholds: {
      low: 30, // below 30  = Low risk
      medium: 60, // 30 to 60  = Medium risk
      high: 80, // 60 to 80  = High risk
      // above 80  = Very High risk
    },
    // Max characters to send per file to AI API
    // Sapling works best with chunks under 2000 chars
    chunkSize: 1500,
  },

  rateLimit: {
    windowMs: 60 * 1000,
    maxPerWindow: 30,
  },

  cache: {
    ttlSeconds: 10 * 60,
  },
};

module.exports = config;
