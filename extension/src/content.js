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
    // Day 2 → demo data with fake 1.5s delay to simulate network
    // Day 5 → replace with real backend POST
    const data = await fetchAnalysis(repoInfo);

    // Step 3: Render results
    renderBadge(shadow, data);
    console.log("[GitTrace] Analysis complete. Score:", data.overallScore);
  } catch (err) {
    console.error("[GitTrace] Analysis failed:", err);
    setBadgeError(shadow, err.message || "Unknown error occurred.");
  }
}

/**
 * Fetch analysis data.
 * Day 2: Returns demo data after a fake delay.
 * Day 5: Replaces this with a real fetch() call to the backend.
 *
 * @param {{ owner: string, repo: string }} repoInfo
 * @returns {Promise}
 */
async function fetchAnalysis(repoInfo) {
  // ── DAY 2: Demo mode ───────────────────────────────────────────
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return getDemoData(repoInfo);

  // ── DAY 5: Real backend call (uncomment this, delete above) ────
  // const response = await fetch('http://localhost:3001/api/analyze', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ owner: repoInfo.owner, repo: repoInfo.repo }),
  // });
  // if (!response.ok) throw new Error(`Backend error: ${response.status}`);
  // return response.json();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  console.log("[GitTrace] Content script init:", window.location.href);

  const repoInfo = parseRepoFromURL();
  if (!repoInfo) {
    console.log("[GitTrace] Not a repo page — skipping.");
    return;
  }

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

init();

/*
 * Day 5: SPA navigation support
 * document.addEventListener('turbo:load', () => {
 *   const existing = document.getElementById(GITTRACE_HOST_ID);
 *   if (existing) existing.remove();
 *   init();
 * });
 */
