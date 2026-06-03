/**
 * GitTrace — Background Service Worker
 *
 * MV3 service workers are ephemeral — Chrome terminates them when idle
 * and restarts them on demand. This means:
 *   ❌ NEVER store state in global variables (lost on termination)
 *   ✅ ALWAYS use chrome.storage for persistence
 *   ✅ Keep handlers fast — service workers have a 5-minute lifetime
 *
 * Day 1: Lifecycle events + message routing stubs.
 * Day 5: ANALYZE_REPO message will forward to backend and return results.
 */

// ─── Installation & Lifecycle ─────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[GitTrace BG] onInstalled fired. Reason:", details.reason);

  if (details.reason === "install") {
    console.log(
      "[GitTrace BG] First install — writing default config to storage.",
    );

    // Write defaults to local storage (persists across browser restarts)
    chrome.storage.local
      .set({
        gittrace_version: "0.1.0",
        gittrace_installed_at: new Date().toISOString(),
        gittrace_enabled: true,
        gittrace_cache_ttl_minutes: 10,
        gittrace_backend_url: "http://localhost:3001",
      })
      .then(() => {
        console.log("[GitTrace BG] Default config written successfully.");
      });
  }

  if (details.reason === "update") {
    console.log("[GitTrace BG] Updated from version:", details.previousVersion);
    // Day 10: Handle migrations between versions here
  }
});

chrome.runtime.onStartup.addListener(() => {
  // Fired when Chrome itself starts (not on every extension wake)
  console.log("[GitTrace BG] Browser startup detected — service worker alive.");
});

// ─── Message Router ───────────────────────────────────────────────────

/**
 * Central message handler.
 * Content scripts send messages here to request background operations.
 *
 * All messages use the shape:   { type: string, payload?: object }
 * All responses use the shape:  { success: boolean, data?: any, error?: string }
 *
 * IMPORTANT: Return `true` from the listener for async handlers,
 * or the message channel closes before sendResponse is called.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? "unknown";
  console.log(`[GitTrace BG] Message "${message.type}" from tab ${tabId}`);

  switch (message.type) {
    // ── Health check ────────────────────────────────────────────────
    case "PING": {
      sendResponse({
        success: true,
        data: {
          pong: true,
          timestamp: Date.now(),
          version: "0.1.0",
        },
      });
      break;
    }

    // ── Full repo analysis (Day 5 implementation) ───────────────────
    case "ANALYZE_REPO": {
      const { owner, repo } = message.payload ?? {};
      console.log(`[GitTrace BG] ANALYZE_REPO for: ${owner}/${repo}`);
      console.log("[GitTrace BG] Full implementation arrives Day 5.");

      // Day 5 will:
      // 1. Check chrome.storage.session cache
      // 2. If cache miss → POST to backend /api/analyze
      // 3. Cache the response
      // 4. Send response back to content script

      sendResponse({
        success: false,
        error: "ANALYZE_REPO not yet implemented (Day 5)",
      });
      break;
    }

    // ── Clear the session cache ─────────────────────────────────────
    case "CLEAR_CACHE": {
      chrome.storage.session
        .clear()
        .then(() => {
          console.log("[GitTrace BG] Session cache cleared.");
          sendResponse({ success: true });
        })
        .catch((err) => {
          console.error("[GitTrace BG] Failed to clear cache:", err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep channel open for async response
    }

    // ── Get current config ──────────────────────────────────────────
    case "GET_CONFIG": {
      chrome.storage.local
        .get(null)
        .then((config) => {
          sendResponse({ success: true, data: config });
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    // ── Unknown message type ────────────────────────────────────────
    default: {
      console.warn("[GitTrace BG] Unknown message type:", message.type);
      sendResponse({
        success: false,
        error: `Unknown message type: "${message.type}"`,
      });
    }
  }
});

// ─── Tab Event Listener ───────────────────────────────────────────────

/**
 * Listen for tab URL changes.
 * Useful for detecting GitHub navigation and prefetching analysis.
 *
 * Day 5 will use this to trigger analysis before the badge even appears.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act on complete page loads
  if (changeInfo.status !== "complete") return;

  // Only act on GitHub repo pages
  if (!tab.url?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+/)) return;

  // Don't fire for GitHub reserved paths
  const path = new URL(tab.url).pathname;
  const firstSegment = path.split("/")[1];
  const RESERVED = new Set([
    "settings",
    "explore",
    "marketplace",
    "features",
    "pricing",
  ]);
  if (RESERVED.has(firstSegment)) return;

  console.log("[GitTrace BG] GitHub repo tab loaded:", tab.url);
  // TODO (Day 5): Optionally prefetch analysis here for faster badge display
});

// ─── Service Worker Boot Log ──────────────────────────────────────────

// This line runs every time the service worker is (re)started by Chrome
console.log("[GitTrace BG] Service worker script evaluated and running.");
