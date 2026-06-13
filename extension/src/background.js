/**
 * GitTrace — Background Service Worker (Day 5 Update)
 *
 * Now fully handles ANALYZE_REPO messages from content scripts.
 * Uses the API module to fetch real data from the backend.
 *
 * Why use the service worker for API calls instead of content.js directly?
 *   - Service workers bypass some CORS restrictions
 *   - Centralized place for retry logic
 *   - Can be used from multiple tabs simultaneously
 */

// ─── Installation ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[GitTrace BG] onInstalled:", details.reason);

  if (details.reason === "install") {
    chrome.storage.local.set({
      gittrace_version: "0.5.0",
      gittrace_installed_at: new Date().toISOString(),
      gittrace_enabled: true,
      gittrace_cache_ttl_minutes: 10,
      gittrace_backend_url: "http://localhost:3001",
      gittrace_demo_mode: false,
    });
    console.log("[GitTrace BG] Default config written for v0.5.0");
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[GitTrace BG] Browser startup — service worker alive.");
});

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    `[GitTrace BG] Message "${message.type}" from tab`,
    sender.tab?.id,
  );

  switch (message.type) {
    // ── Health check ────────────────────────────────────────────────
    case "PING":
      sendResponse({
        success: true,
        data: {
          pong: true,
          timestamp: Date.now(),
          version: "0.5.0",
        },
      });
      break;

    // ── Full repo analysis ──────────────────────────────────────────
    // Content script sends this — background fetches and responds
    case "ANALYZE_REPO": {
      const { owner, repo, forceRefresh } = message.payload ?? {};

      if (!owner || !repo) {
        sendResponse({ success: false, error: "owner and repo are required" });
        break;
      }

      // We must return true to keep the message channel open
      // while the async fetch completes
      handleAnalyzeRepo(owner, repo, forceRefresh, sendResponse);
      return true; // IMPORTANT: keep channel open for async response
    }

    // ── Clear session cache ─────────────────────────────────────────
    case "CLEAR_CACHE":
      chrome.storage.session
        .clear()
        .then(() => {
          console.log("[GitTrace BG] Session cache cleared.");
          sendResponse({ success: true });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    // ── Get config ──────────────────────────────────────────────────
    case "GET_CONFIG":
      chrome.storage.local
        .get(null)
        .then((config) => sendResponse({ success: true, data: config }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    // ── Set backend URL ─────────────────────────────────────────────
    case "SET_BACKEND_URL": {
      const { url } = message.payload ?? {};
      if (!url) {
        sendResponse({ success: false, error: "url is required" });
        break;
      }
      chrome.storage.local
        .set({ gittrace_backend_url: url })
        .then(() => sendResponse({ success: true, data: { url } }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // ── Unknown ─────────────────────────────────────────────────────
    default:
      console.warn("[GitTrace BG] Unknown message type:", message.type);
      sendResponse({ success: false, error: `Unknown: "${message.type}"` });
  }
});

// ─── Analyze Handler ──────────────────────────────────────────────────────────

/**
 * Handle the ANALYZE_REPO message.
 * Fetches from backend API and sends result back to content script.
 *
 * @param {string}   owner
 * @param {string}   repo
 * @param {boolean}  forceRefresh
 * @param {Function} sendResponse
 */
async function handleAnalyzeRepo(owner, repo, forceRefresh, sendResponse) {
  try {
    console.log(
      `[GitTrace BG] Analyzing: ${owner}/${repo} forceRefresh=${forceRefresh}`,
    );

    // Get backend URL from storage
    const config = await chrome.storage.local.get("gittrace_backend_url");
    const backendUrl = config.gittrace_backend_url || "http://localhost:3001";

    // Check session cache first
    if (!forceRefresh) {
      const cacheKey = `gt_${owner}_${repo}`;
      const cached = await chrome.storage.session.get(cacheKey);
      const entry = cached[cacheKey];

      if (entry) {
        const TEN_MIN = 10 * 60 * 1000;
        if (Date.now() - entry.cachedAt < TEN_MIN) {
          console.log("[GitTrace BG] Cache hit:", cacheKey);
          sendResponse({
            success: true,
            data: { ...entry.data, fromCache: true },
          });
          return;
        }
        // Expired — remove it
        await chrome.storage.session.remove(cacheKey);
      }
    }

    // Fetch from backend
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    let response;
    try {
      response = await fetch(`${backendUrl}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitTrace-Key": "dev-secret-day3",
        },
        body: JSON.stringify({ owner, repo }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Cache the result in session storage
    const cacheKey = `gt_${owner}_${repo}`;
    await chrome.storage.session.set({
      [cacheKey]: { data, cachedAt: Date.now() },
    });

    console.log(
      `[GitTrace BG] Success: ${owner}/${repo} score=${data.aiAnalysis?.overallScore}`,
    );
    sendResponse({ success: true, data });
  } catch (err) {
    console.error("[GitTrace BG] ANALYZE_REPO failed:", err.message);
    sendResponse({
      success: false,
      error: err.message || "Unknown error from background",
    });
  }
}

// ─── Tab Listener ─────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+/)) return;
  console.log("[GitTrace BG] GitHub repo tab loaded:", tab.url);
});

console.log("[GitTrace BG] Service worker v0.5.0 running.");
