/**
 * GitTrace — Background Service Worker (Day 2 update)
 */

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[GitTrace BG] onInstalled:", details.reason);

  if (details.reason === "install") {
    chrome.storage.local.set({
      gittrace_version: "0.2.0",
      gittrace_installed_at: new Date().toISOString(),
      gittrace_enabled: true,
      gittrace_cache_ttl_minutes: 10,
      gittrace_backend_url: "http://localhost:3001",
      gittrace_demo_mode: true,
    });
    console.log("[GitTrace BG] Default config written.");
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[GitTrace BG] Browser startup — service worker alive.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    `[GitTrace BG] Message "${message.type}" from tab`,
    sender.tab?.id,
  );

  switch (message.type) {
    case "PING":
      sendResponse({
        success: true,
        data: { pong: true, timestamp: Date.now(), version: "0.2.0" },
      });
      break;

    case "ANALYZE_REPO": {
      const { owner, repo } = message.payload ?? {};
      console.log(
        `[GitTrace BG] ANALYZE_REPO: ${owner}/${repo} — real fetch coming Day 5`,
      );
      sendResponse({ success: false, error: "Not implemented until Day 5" });
      break;
    }

    case "CLEAR_CACHE":
      chrome.storage.session
        .clear()
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case "GET_CONFIG":
      chrome.storage.local
        .get(null)
        .then((config) => {
          sendResponse({ success: true, data: config });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case "SET_DEMO_MODE": {
      const { enabled } = message.payload ?? {};
      chrome.storage.local.set({ gittrace_demo_mode: enabled }).then(() => {
        sendResponse({ success: true, data: { demo_mode: enabled } });
      });
      return true;
    }

    default:
      console.warn("[GitTrace BG] Unknown message type:", message.type);
      sendResponse({
        success: false,
        error: `Unknown message type: "${message.type}"`,
      });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+/)) return;
  console.log("[GitTrace BG] GitHub repo tab loaded:", tab.url);
});

console.log("[GitTrace BG] Service worker v0.2.0 running.");
