/**
 * GitTrace Backend — In-Memory Cache
 *
 * Simple key-value cache with TTL (time to live).
 * Prevents hammering GitHub API + Sapling API for the same repo.
 *
 * Cache key: "owner/repo"
 * TTL: 10 minutes (configured in config.js)
 *
 * For production scale: replace with Redis.
 * For MVP: this in-memory cache is perfectly fine.
 */

const config = require("../config");

// ─── Cache Store ──────────────────────────────────────────────────────────────

/**
 * Map of cacheKey → { data, expiresAt }
 * @type {Map<string, { data: any, expiresAt: number }>}
 */
const store = new Map();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a value from cache.
 * Returns null if key does not exist or has expired.
 *
 * @param {string} key
 * @returns {any | null}
 */
function get(key) {
  const entry = store.get(key);

  if (!entry) return null;

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    console.log(`[Cache] Expired and removed: ${key}`);
    return null;
  }

  const remainingSecs = Math.round((entry.expiresAt - Date.now()) / 1000);
  console.log(`[Cache] HIT: ${key} (expires in ${remainingSecs}s)`);
  return entry.data;
}

/**
 * Store a value in cache with TTL.
 *
 * @param {string} key
 * @param {any}    data
 * @param {number} [ttlSeconds] - Optional override for TTL
 */
function set(key, data, ttlSeconds) {
  const ttl = (ttlSeconds || config.cache.ttlSeconds) * 1000;
  const expiresAt = Date.now() + ttl;

  store.set(key, { data, expiresAt });
  console.log(
    `[Cache] SET: ${key} (TTL: ${ttlSeconds || config.cache.ttlSeconds}s)`,
  );
}

/**
 * Delete a specific key from cache.
 * @param {string} key
 */
function del(key) {
  store.delete(key);
  console.log(`[Cache] DEL: ${key}`);
}

/**
 * Clear the entire cache.
 */
function clear() {
  const count = store.size;
  store.clear();
  console.log(`[Cache] CLEAR: removed ${count} entries`);
}

/**
 * Get cache stats for debugging.
 * @returns {{ size: number, keys: string[] }}
 */
function stats() {
  return {
    size: store.size,
    keys: [...store.keys()],
  };
}

module.exports = { get, set, del, clear, stats };
