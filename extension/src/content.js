/**
 * GitTrace — Content Script
 * Injected into every https://github.com/USER/REPO/* page.
 *
 * Day 1 responsibilities:
 *   1. Detect if current page is a GitHub repository page
 *   2. Extract owner + repo name from the URL
 *   3. Find the correct header insertion point
 *   4. Mount an isolated Shadow DOM badge
 *   5. Render a static "Scanning…" placeholder
 */

// ─── Constants ────────────────────────────────────────────────────────

/**
 * Unique ID for the badge host element.
 * Used to prevent duplicate injection on re-runs.
 */
const GITTRACE_HOST_ID = "gittrace-badge-host";

/**
 * Regex to match GitHub repository pages.
 * Matches:  /owner/repo
 *           /owner/repo/tree/branch/...
 *           /owner/repo/blob/main/file.js
 * Excludes: /owner (user pages)
 *           / (homepage)
 */
const REPO_PAGE_REGEX = /^\/([^/]+)\/([^/]+)(\/|$)/;

/**
 * GitHub's own reserved top-level paths that match the regex
 * but are NOT repository pages. We must explicitly exclude them.
 */
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

// ─── URL Parsing ──────────────────────────────────────────────────────

/**
 * Parse the current page URL to determine if it's a repo page.
 * Returns { owner, repo } if yes, or null if not a repo page.
 *
 * @returns {{ owner: string, repo: string } | null}
 */
function parseRepoFromURL() {
  const match = window.location.pathname.match(REPO_PAGE_REGEX);

  // No match = definitely not a repo page
  if (!match) return null;

  const owner = match[1];
  const repo = match[2];

  // Exclude GitHub's own reserved top-level paths
  if (GITHUB_RESERVED_PATHS.has(owner)) return null;

  // Exclude dot-prefixed paths (.github, etc.)
  if (owner.startsWith(".")) return null;

  return { owner, repo };
}

// ─── DOM Helpers ──────────────────────────────────────────────────────

/**
 * Find the best insertion point for the badge in GitHub's header.
 *
 * GitHub has changed their header HTML multiple times.
 * We try selectors in order of preference — most specific first.
 *
 * @returns {Element | null}
 */
function findHeaderInsertionPoint() {
  const selectors = [
    // New GitHub UI (2024): action buttons area in repo header
    ".AppHeader-actions",
    // Repository-specific toolbar
    "#repository-details-container",
    // Older GitHub layout
    ".pagehead-actions",
    // Fallback: the repo name heading area
    '[itemprop="name"]',
    // Nuclear fallback: top-level header
    'header[role="banner"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      console.log(`[GitTrace] Insertion point found: "${selector}"`);
      return el;
    }
  }

  return null;
}

// ─── Badge Styles ─────────────────────────────────────────────────────

/**
 * CSS injected into the Shadow DOM.
 * Completely isolated from GitHub's styles.
 *
 * Day 1: minimal placeholder styles.
 * Day 2: replaced with full TailwindCSS + score ring.
 */
const BADGE_STYLES = `
  /* Reset inside Shadow DOM */
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* Host element — sits inline with other header items */
  :host {
    display: inline-flex;
    align-items: center;
    margin-right: 8px;
    vertical-align: middle;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
                 Helvetica, Arial, sans-serif;
  }

  /* Main badge pill */
  .gt-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px;
    background: #0d1117;
    border: 1.5px solid #30363d;
    border-radius: 20px;
    cursor: pointer;
    user-select: none;
    text-decoration: none;
    transition: border-color 0.2s ease, background 0.2s ease;
    position: relative;
    overflow: hidden;
  }

  /* Shimmer effect on the badge while loading */
  .gt-badge::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(110, 110, 255, 0.06) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: gt-shimmer 2s linear infinite;
  }

  .gt-badge:hover {
    border-color: #6e6eff;
    background: #161b22;
  }

  .gt-badge:active {
    transform: scale(0.98);
  }

  /* Animated status dot */
  .gt-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6e6eff;
    flex-shrink: 0;
    animation: gt-pulse 1.8s ease-in-out infinite;
    position: relative;
    z-index: 1;
  }

  /* "GitTrace" brand label */
  .gt-label {
    font-size: 11px;
    font-weight: 700;
    color: #8b949e;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    position: relative;
    z-index: 1;
  }

  /* Score / status text */
  .gt-score {
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
    position: relative;
    z-index: 1;
  }

  /* Divider between label and score */
  .gt-divider {
    width: 1px;
    height: 12px;
    background: #30363d;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  }

  /* ── Animations ─────────────────── */

  @keyframes gt-pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(110, 110, 255, 0.4);
    }
    50% {
      opacity: 0.7;
      transform: scale(0.8);
      box-shadow: 0 0 0 4px rgba(110, 110, 255, 0);
    }
  }

  @keyframes gt-shimmer {
    0%   { background-position: 200% center; }
    100% { background-position: -200% center; }
  }
`;

// ─── Badge HTML ───────────────────────────────────────────────────────

/**
 * Build the badge HTML element for Day 1 placeholder state.
 *
 * @param {{ owner: string, repo: string }} repoInfo
 * @returns {HTMLElement}
 */
function buildBadgeElement(repoInfo) {
  const badge = document.createElement("div");
  badge.className = "gt-badge";
  badge.setAttribute("role", "button");
  badge.setAttribute("tabindex", "0");
  badge.setAttribute(
    "aria-label",
    "GitTrace: analyzing repository for AI-generated code",
  );
  badge.setAttribute("title", `GitTrace — ${repoInfo.owner}/${repoInfo.repo}`);

  badge.innerHTML = `
    <span class="gt-dot" aria-hidden="true"></span>
    <span class="gt-label">GitTrace</span>
    <span class="gt-divider" aria-hidden="true"></span>
    <span class="gt-score">Scanning…</span>
  `;

  // Click handler — Day 2 replaces this with dropdown toggle
  badge.addEventListener("click", () => {
    console.log("[GitTrace] Badge clicked. Dropdown UI arrives Day 2.");
    alert(
      `GitTrace — Day 1 Checkpoint\n\n` +
        `✅ Repo detected: ${repoInfo.owner}/${repoInfo.repo}\n` +
        `✅ Shadow DOM badge mounted\n` +
        `✅ Content script running\n\n` +
        `Full AI scoring arrives on Day 4.`,
    );
  });

  // Keyboard accessibility — trigger click on Enter/Space
  badge.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      badge.click();
    }
  });

  return badge;
}

// ─── Shadow DOM Mount ─────────────────────────────────────────────────

/**
 * Create the host element, attach a Shadow DOM, and render the badge inside it.
 *
 * Why Shadow DOM?
 *   - GitHub's CSS (thousands of rules) cannot reach inside → no style conflicts
 *   - Our CSS cannot leak out → we can't accidentally break GitHub's layout
 *   - We have a fully controlled rendering environment
 *
 * @param {Element} insertionPoint  - Where to inject the host element
 * @param {{ owner: string, repo: string }} repoInfo
 */
function mountBadge(insertionPoint, repoInfo) {
  // Create a neutral host element (span has no semantic meaning)
  const host = document.createElement("span");
  host.id = GITTRACE_HOST_ID;

  // Store metadata as data attributes for debugging
  host.setAttribute("data-owner", repoInfo.owner);
  host.setAttribute("data-repo", repoInfo.repo);
  host.setAttribute("data-version", "0.1.0");
  host.setAttribute("data-gittrace", "true");

  // Insert at the beginning of the action area
  insertionPoint.insertBefore(host, insertionPoint.firstChild);

  // Attach shadow root — 'open' mode so content.js can query it later
  const shadow = host.attachShadow({ mode: "open" });

  // Inject styles
  const styleEl = document.createElement("style");
  styleEl.textContent = BADGE_STYLES;
  shadow.appendChild(styleEl);

  // Inject badge HTML
  const badge = buildBadgeElement(repoInfo);
  shadow.appendChild(badge);

  console.log(
    `[GitTrace] Shadow DOM badge mounted for: ${repoInfo.owner}/${repoInfo.repo}`,
  );
}

// ─── Main Init ────────────────────────────────────────────────────────

/**
 * Initialize GitTrace on the current page.
 * Safe to call multiple times — duplicate check prevents double injection.
 */
function init() {
  console.log("[GitTrace] Content script init:", window.location.href);

  // Step 1: Is this a repo page?
  const repoInfo = parseRepoFromURL();
  if (!repoInfo) {
    console.log("[GitTrace] Not a repo page — skipping injection.");
    return;
  }
  console.log("[GitTrace] Repo detected:", repoInfo);

  // Step 2: Prevent duplicate badge
  if (document.getElementById(GITTRACE_HOST_ID)) {
    console.log("[GitTrace] Badge already mounted — skipping duplicate.");
    return;
  }

  // Step 3: Find insertion point in GitHub header
  const insertionPoint = findHeaderInsertionPoint();
  if (!insertionPoint) {
    console.warn(
      "[GitTrace] Header insertion point not found. GitHub may have changed their DOM.",
    );
    console.warn(
      '[GitTrace] Tried selectors: .AppHeader-actions, #repository-details-container, .pagehead-actions, [itemprop="name"], header[role="banner"]',
    );
    return;
  }

  // Step 4: Mount the badge
  mountBadge(insertionPoint, repoInfo);
}

// ─── Run ──────────────────────────────────────────────────────────────

// document_idle guarantees DOM is ready — run immediately
init();

/*
 * Day 5 will add SPA navigation support here:
 *
 * GitHub is a single-page app. After the initial load, navigating between
 * repos does NOT trigger a full page reload — it uses Turbo (formerly Turbolinks).
 * We must listen for these events and re-run init().
 *
 * document.addEventListener('turbo:load', () => {
 *   const existing = document.getElementById(GITTRACE_HOST_ID);
 *   if (existing) existing.remove();   // remove stale badge from previous repo
 *   init();
 * });
 *
 * document.addEventListener('pjax:end', () => {
 *   const existing = document.getElementById(GITTRACE_HOST_ID);
 *   if (existing) existing.remove();
 *   init();
 * });
 */
