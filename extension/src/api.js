/**
 * GitTrace — API Client Module
 *
 * Handles all communication between the Chrome extension
 * and the GitTrace backend server.
 *
 * Responsibilities:
 *   - POST to /api/analyze with owner + repo
 *   - Handle timeouts gracefully
 *   - Retry once on network failure
 *   - Return structured result or structured error
 */

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Backend URLs.
 * Dev:  your local Node server
 * Prod: your deployed server (Day 10)
 *
 * We try DEV first. If it fails we fall back to PROD.
 * This means during development you get local server speed,
 * and in production the extension works without code changes.
 */
const BACKEND_URLS = {
  dev: "http://localhost:3001",
  prod: "https://gittrace-api.onrender.com",
};

// How long to wait before giving up on a request (milliseconds)
const REQUEST_TIMEOUT_MS = 20000; // 20 seconds

// Shared secret header — must match GITTRACE_SECRET in backend .env
const GITTRACE_SECRET = "dev-secret-day3";

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = "gittrace_cache_";
const BACKEND_URL_KEY = "gittrace_backend_url";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the backend URL to use.
 * First checks chrome.storage.local for a saved preference.
 * Falls back to dev URL.
 *
 * @returns {Promise<string>}
 */
async function getBackendURL() {
  try {
    const result = await chrome.storage.local.get(BACKEND_URL_KEY);
    return result[BACKEND_URL_KEY] || BACKEND_URLS.dev;
  } catch {
    return BACKEND_URLS.dev;
  }
}

/**
 * Save the working backend URL so future requests use the same one.
 * @param {string} url
 */
async function saveBackendURL(url) {
  try {
    await chrome.storage.local.set({ [BACKEND_URL_KEY]: url });
  } catch {
    // Non-critical — ignore storage errors
  }
}

/**
 * Build a cache key for a specific repo.
 * @param {string} owner
 * @param {string} repo
 * @returns {string}
 */
function buildCacheKey(owner, repo) {
  return `${CACHE_KEY_PREFIX}${owner}_${repo}`;
}

/**
 * Make a fetch request with a timeout.
 * Rejects with a clear error message if timeout is exceeded.
 *
 * @param {string}  url
 * @param {object}  options  - fetch options
 * @param {number}  timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Cache Functions ──────────────────────────────────────────────────────────

/**
 * Try to get a cached analysis result from chrome.storage.session.
 * session storage is cleared when the browser is closed — perfect for this.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<object|null>} Cached data or null if not found / expired
 */
async function getCachedResult(owner, repo) {
  try {
    const key = buildCacheKey(owner, repo);
    const result = await chrome.storage.session.get(key);
    const entry = result[key];

    if (!entry) return null;

    // Check if expired (10 minutes)
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - entry.cachedAt > TEN_MINUTES) {
      console.log("[GitTrace API] Cache expired for:", `${owner}/${repo}`);
      await chrome.storage.session.remove(key);
      return null;
    }

    console.log("[GitTrace API] Cache hit for:", `${owner}/${repo}`);
    return entry.data;
  } catch (err) {
    console.warn("[GitTrace API] Cache read failed:", err.message);
    return null;
  }
}

/**
 * Save an analysis result to chrome.storage.session.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {object} data
 */
async function setCachedResult(owner, repo, data) {
  try {
    const key = buildCacheKey(owner, repo);
    const entry = { data, cachedAt: Date.now() };
    await chrome.storage.session.set({ [key]: entry });
    console.log("[GitTrace API] Cached result for:", `${owner}/${repo}`);
  } catch (err) {
    console.warn("[GitTrace API] Cache write failed:", err.message);
  }
}

/**
 * Clear the cached result for a specific repo.
 * Called when user clicks "Refresh" in the badge dropdown.
 *
 * @param {string} owner
 * @param {string} repo
 */
async function clearCachedResult(owner, repo) {
  try {
    const key = buildCacheKey(owner, repo);
    await chrome.storage.session.remove(key);
    console.log("[GitTrace API] Cache cleared for:", `${owner}/${repo}`);
  } catch (err) {
    console.warn("[GitTrace API] Cache clear failed:", err.message);
  }
}

// ─── Core API Call ────────────────────────────────────────────────────────────

/**
 * Make one POST request to the backend analyze endpoint.
 *
 * @param {string} backendUrl - Base URL of the backend
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<object>} Parsed JSON response
 */
async function postAnalyze(backendUrl, owner, repo) {
  const url = `${backendUrl}/api/analyze`;

  console.log("[GitTrace API] POST", url, { owner, repo });

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitTrace-Key": GITTRACE_SECRET,
      },
      body: JSON.stringify({ owner, repo }),
    },
    REQUEST_TIMEOUT_MS,
  );

  // Parse JSON regardless of status code
  // (error responses also return JSON)
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Backend error: HTTP ${response.status}`);
  }

  return data;
}

// ─── Main Export Function ─────────────────────────────────────────────────────

/**
 * Fetch analysis for a GitHub repository.
 *
 * Flow:
 *   1. Check extension cache (chrome.storage.session)
 *   2. If cache miss → try dev backend
 *   3. If dev fails → try prod backend
 *   4. Cache successful result
 *   5. Return data or throw with clear error message
 *
 * @param {string}  owner
 * @param {string}  repo
 * @param {boolean} forceRefresh - Skip cache and re-fetch
 * @returns {Promise<object>} Full analysis payload from backend
 */
async function analyzeRepo(owner, repo, forceRefresh = false) {
  console.log(
    `[GitTrace API] analyzeRepo(${owner}/${repo}) forceRefresh=${forceRefresh}`,
  );

  // Step 1: Check cache (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedResult(owner, repo);
    if (cached) return { ...cached, fromExtensionCache: true };
  } else {
    await clearCachedResult(owner, repo);
  }

  // Step 2: Try backends in order
  const savedUrl = await getBackendURL();
  const urlsToTry = [savedUrl];

  // Add the other URL if it is different from saved
  if (savedUrl === BACKEND_URLS.dev) {
    urlsToTry.push(BACKEND_URLS.prod);
  } else {
    urlsToTry.push(BACKEND_URLS.dev);
  }

  // Remove duplicates
  const uniqueUrls = [...new Set(urlsToTry)];

  let lastError = null;

  for (const url of uniqueUrls) {
    try {
      console.log(`[GitTrace API] Trying backend: ${url}`);
      const data = await postAnalyze(url, owner, repo);

      // Save the working URL for next time
      await saveBackendURL(url);

      // Step 3: Cache the result
      await setCachedResult(owner, repo, data);

      return { ...data, fromExtensionCache: false };
    } catch (err) {
      console.warn(`[GitTrace API] Backend ${url} failed:`, err.message);
      lastError = err;
      // Continue to next URL
    }
  }

  // All backends failed
  throw new Error(
    lastError?.message ||
      "Could not connect to GitTrace backend. Make sure the server is running on localhost:3001.",
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { analyzeRepo, clearCachedResult, BACKEND_URLS };
