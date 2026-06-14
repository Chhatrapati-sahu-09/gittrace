/**
 * GitTrace — Content Script (Day 2)
 *
 * Now uses badge.js for all UI rendering.
 * Day 2 wires up:
 *   - Full badge UI via buildBadgeHTML()
 *   - Tab switching via initTabs()
 *   - Dropdown toggle via initDropdownToggle()
 *   - Refresh button handler
 *   - Demo mode with fake data to test UI without backend
 */

import {
  BADGE_CSS,
  buildBadgeHTML,
  initTabs,
  initDropdownToggle,
  setBadgeLoading,
  setBadgeError,
  renderBadge,
} from "./badge.js";
import { injectHeatmap, removeHeatmap, watchFileTree } from "./heatmap.js";
import {
  buildCompatReport,
  saveUserRuntimeVersions,
} from './osDetector.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const GITTRACE_HOST_ID = "gittrace-badge-host";

const REPO_PAGE_REGEX = /^\/([^/]+)\/([^/]+)(\/|$)/;

const GITHUB_RESERVED_PATHS = new Set([
  "settings",
  "notifications",
  "explore",
  "marketplace",
  "issues",
  "pulls",
  "discussions",
  "sponsors",
  "login",
  "join",
  "organizations",
  "features",
  "pricing",
  "about",
  "new",
  "codespaces",
  "copilot",
  "trending",
]);

// Holds the MutationObserver so we can disconnect it on navigation
let heatmapObserver = null;
let currentRepo = "";

// ─── URL Parsing ──────────────────────────────────────────────────────────────

function parseRepoFromURL() {
  const match = window.location.pathname.match(REPO_PAGE_REGEX);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2];

  if (GITHUB_RESERVED_PATHS.has(owner)) return null;
  if (owner.startsWith(".")) return null;

  return { owner, repo };
}

// ─── Header Insertion Point ───────────────────────────────────────────────────

function findHeaderInsertionPoint() {
  const selectors = [
    ".AppHeader-actions",
    "#repository-details-container",
    ".pagehead-actions",
    '[itemprop="name"]',
    'header[role="banner"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      console.log(`[GitTrace] Insertion point: "${selector}"`);
      return el;
    }
  }
  return null;
}

// ─── Demo Data (Day 2 — replace with real API call on Day 5) ─────────────────

/**
 * Simulate what the backend will return on Day 5.
 * This lets us test the full UI without a backend.
 *
 * @param {{ owner: string, repo: string }} repoInfo
 * @returns {object} Fake analysis result
 */
function getDemoData(repoInfo) {
  return {
    overallScore: 74,
    label: "High",
    perFileScores: [
      { path: "src/index.js", score: 91 },
      { path: "src/utils.js", score: 78 },
      { path: "src/api.js", score: 65 },
      { path: "README.md", score: 45 },
      { path: "package.json", score: 20 },
      { path: "src/components.js", score: 88 },
    ],
    commitFlags: [
      {
        message: "initial commit",
        additions: 2400,
        flag: "Superhuman velocity: 2400 lines in 4s",
      },
    ],
    licenseInfo: {
      spdx: "MIT",
      risk: "Safe",
      colour: "green",
    },
    securityIssues: {
      cves: [
        {
          id: "CVE-2023-44270",
          severity: "High",
          package: "postcss",
          summary: "Line return parsing issue",
        },
      ],
      phantoms: [{ name: "lodash-utils-pro", registry: "npm" }],
      secrets: [{ type: "AWS Access Key", file: "src/config.js" }],
    },
    compatInfo: {
      userOS: navigator.platform,
      nodeRequired: ">=18.0.0",
      pythonRequired: null,
      arch: "x64",
    },
  };
}

// ─── Mount Badge ──────────────────────────────────────────────────────────────

/**
 * Create Shadow DOM host and render the full badge UI inside it.
 *
 * @param {Element} insertionPoint
 * @param {{ owner: string, repo: string }} repoInfo
 */
function mountBadge(insertionPoint, repoInfo) {
  // Create host span
  const host = document.createElement("span");
  host.id = GITTRACE_HOST_ID;
  host.setAttribute("data-owner", repoInfo.owner);
  host.setAttribute("data-repo", repoInfo.repo);
  host.setAttribute("data-version", "0.2.0");
  host.setAttribute("data-gittrace", "true");

  insertionPoint.insertBefore(host, insertionPoint.firstChild);

  // Attach shadow root
  const shadow = host.attachShadow({ mode: "open" });

  // Inject styles
  const styleEl = document.createElement("style");
  styleEl.textContent = BADGE_CSS;
  shadow.appendChild(styleEl);

  // Inject badge + dropdown HTML
  const badgeHTML = buildBadgeHTML(repoInfo);
  shadow.appendChild(badgeHTML);

  // Wire tabs
  initTabs(shadow);

  // Wire dropdown toggle
  initDropdownToggle(shadow, host);

  // Wire refresh button
  const refreshBtn = shadow.getElementById("gt-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      console.log("[GitTrace] Refresh clicked — re-scanning.");
      runAnalysis(shadow, repoInfo);
    });
  }

  console.log(
    `[GitTrace] Badge mounted for: ${repoInfo.owner}/${repoInfo.repo}`,
  );

  // Run analysis immediately
  runAnalysis(shadow, repoInfo);
}

// ─── API Response Transformer ────────────────────────────────────────────────

/**
 * Transform raw backend API response into the structure expected by renderBadge.
 *
 * @param {object} response - The API response object (from background or direct fetch)
 * @returns {object} Flatter object for renderBadge
 */
function transformAPIResponse(response) {
  if (!response) return null;

  const data = response.data || response;

  return {
    overallScore:   data.aiAnalysis?.overallScore ?? data.overallScore ?? 0,
    label:          data.aiAnalysis?.label ?? data.label ?? 'Unknown',
    perFileScores:  data.aiAnalysis?.perFileScores ?? data.perFileScores ?? [],
    commitFlags:    data.commits?.velocity?.flags ?? data.commitFlags ?? [],
    licenseInfo:    data.license ?? data.licenseInfo ?? null,
    securityIssues: data.securityIssues ?? { cves: [], phantoms: [], secrets: [] },
    // System compatibility — NOW uses real OS detection
    compatInfo: null,  // Will be set by buildCompatReport() below
    compatReport: null,  // Set after buildCompatReport() runs
  };
}

// ─── Analysis Runner ──────────────────────────────────────────────────────────

/**
 * Run the analysis flow:
 *   1. Set loading state
 *   2. Fetch from backend (Day 5) or use demo data (Day 2)
 *   3. Render results or error
 *
 * @param {ShadowRoot} shadow
 * @param {{ owner: string, repo: string }} repoInfo
 */
async function runAnalysis(shadow, repoInfo) {
  console.log("[GitTrace] Starting analysis for:", repoInfo);

  // Step 1: Show loading state
  setBadgeLoading(shadow);

  try {
    // Step 2: Get data
    const response = await fetchAnalysis(repoInfo);

    // Transform raw API response
    const badgeData = transformAPIResponse(response);

    // Build compat report by comparing user env vs repo requirements
    const compatReport = await buildCompatReport(response.data.compatInfo);

    // Merge compat into badge data
    badgeData.compatReport = compatReport;

    // Render the badge with real scores
    renderBadge(shadow, badgeData);

    // Inject file tree heatmap if we have per-file scores
    if (badgeData.perFileScores && badgeData.perFileScores.length > 0) {
      // Remove any existing dots first (in case of refresh)
      removeHeatmap();
      if (heatmapObserver) {
        heatmapObserver.disconnect();
        heatmapObserver = null;
      }

      // Inject dots into the current file tree
      injectHeatmap(badgeData.perFileScores);

      // Watch for dynamic rendering of more file rows
      heatmapObserver = watchFileTree(badgeData.perFileScores);
    }

    console.log("[GitTrace] Analysis complete. Score:", badgeData.overallScore);
  } catch (err) {
    console.error("[GitTrace] Analysis failed:", err);
    setBadgeError(shadow, err.message || "Unknown error occurred.");
  }
}

/**
 * Fetch analysis data.
 * Calls the background service worker to fetch analysis for the repo.
 *
 * @param {{ owner: string, repo: string }} repoInfo
 * @returns {Promise}
 */
async function fetchAnalysis(repoInfo) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "ANALYZE_REPO",
        payload: { owner: repoInfo.owner, repo: repoInfo.repo },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || "Unknown backend error"));
        }
      }
    );
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  console.log("[GitTrace] Content script init:", window.location.href);

  const repoInfo = parseRepoFromURL();
  if (!repoInfo) {
    console.log("[GitTrace] Not a repo page — skipping.");
    return;
  }

  currentRepo = `${repoInfo.owner}/${repoInfo.repo}`;

  if (document.getElementById(GITTRACE_HOST_ID)) {
    console.log("[GitTrace] Badge already mounted — skipping.");
    return;
  }

  const insertionPoint = findHeaderInsertionPoint();
  if (!insertionPoint) {
    console.warn("[GitTrace] Header insertion point not found.");
    return;
  }

  mountBadge(insertionPoint, repoInfo);
}

function handleNavigation() {
  const repoInfo = parseRepoFromURL();
  const newRepo  = repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : '';
  if (newRepo === currentRepo) return;
  currentRepo = newRepo;
  console.log('[GitTrace] Navigation detected. New repo:', newRepo || '(none)');

  // Clean up heatmap observer
  if (heatmapObserver) {
    heatmapObserver.disconnect();
    heatmapObserver = null;
  }

  // Remove old heatmap dots
  removeHeatmap();

  // Remove old badge
  const existing = document.getElementById(GITTRACE_HOST_ID);
  if (existing) {
    existing.remove();
    console.log('[GitTrace] Old badge removed.');
  }

  init();
}

// SPA navigation support
document.addEventListener('turbo:load', handleNavigation);

init();
